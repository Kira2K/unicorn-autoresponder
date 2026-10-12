import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { assertCopyDatabase } from '../../../integrations/postgres/read-session.mts'
import { canonicalUrl } from './identity.ts'
import { redact } from './store.ts'
import { assertCollectionReady } from '../stack_classification/index.ts'
import type { RuntimeDatabase } from './postgres.ts'
import type { Store, BatchState, Candidate } from '../types.ts'
import type { SqlSession } from '../../../integrations/postgres/contracts.mts'

/** SQL is authoritative for batches/outcomes. Local storage owns CVs and diagnostic files. */
export function createPostgresStore(local: Store, db: RuntimeDatabase, studentOverride?: string): Store {
  const locks = new Map<string, SqlSession>()
  const binding = async (id: string) => {
    const candidate = await local.candidate(id), student = studentOverride ?? candidate.databaseClientId
    if (!student || !/^[1-9]\d*$/.test(student)) throw new PostgresReadError('database_student_binding_required')
    if (candidate.databaseClientId && candidate.databaseClientId !== student) throw new PostgresReadError('database_student_binding_changed')
    return { candidate, student }
  }
  async function candidate(id: string): Promise<Candidate> {
    const { candidate, student } = await binding(id)
    candidate.databaseClientId = student
    const history = await db.read(async s => (await s.query(`SELECT a.id::text,a.submission_status,a.confirmation_kind,a.confirmed_at,c.name,v.title,v.canonical_url
      FROM noco.applications a JOIN noco.companies c ON c.id=a.company_id LEFT JOIN noco.vacancies v ON v.id=a.vacancy_id
      WHERE a.client_id=$1 AND a.channel<>'external-responses'`, [student])).rows)
    for (const row of history) {
      // Canonical greenhouse identities aren't URLs; retained legacy history must never crash URL matching.
      if (!/^https?:/.test(String(row.canonical_url ?? ''))) continue
      candidate.history.push({ company: String(row.name), title: String(row.title ?? ''), url: String(row.canonical_url),
        status: row.submission_status === 'submitted' ? 'succeeded' : 'unknown',
        confirmation: row.confirmation_kind === 'captured' ? 'captured' : row.confirmation_kind === 'candidate_reported' ? 'operator_reported' : undefined,
        date: row.confirmed_at ? new Date(String(row.confirmed_at)).toISOString() : undefined })
    }
    return candidate
  }
  return {
    candidate, saveCandidate: c => local.saveCandidate(c), event: e => local.event(e),
    async batch(id, batchId) {
      const { student } = await binding(id)
      const value = await db.read(async s => (await s.query('SELECT state FROM noco.application_batches WHERE client_id=$1 AND id=$2', [student, batchId])).rows[0]?.state as BatchState | undefined)
      if (value && value.candidateId !== id) throw new PostgresReadError('batch_candidate_binding_changed')
      if (!value && await local.batch(id, batchId)) throw new PostgresReadError('legacy_batch_import_required')
      return value
    },
    async batches(id) {
      const { student } = await binding(id)
      const saved = await db.read(async s => (await s.query('SELECT state FROM noco.application_batches WHERE client_id=$1 ORDER BY id', [student])).rows.map(r => r.state as BatchState))
      const history = await local.batches(id)
      return [...saved, ...history.filter(b => !saved.some(s => s.id === b.id))]
    },
    async lock(id) {
      const { student } = await binding(id)
      if (locks.has(student)) throw new PostgresReadError('candidate_application_locked')
      const session = await db.pool.connect()
      try {
        await assertCopyDatabase(session, db.database)
        const locked = (await session.query('SELECT pg_try_advisory_lock(1789941003,hashtext($1)) AS locked', [student])).rows[0]?.locked
        if (!locked) throw new PostgresReadError('candidate_application_locked')
        locks.set(student, session)
      } catch (error) { session.release(true); throw error }
      return async () => {
        locks.delete(student)
        let broken = false
        try { await session.query('SELECT pg_advisory_unlock(1789941003,hashtext($1))', [student]) } catch { broken = true }
        session.release(broken)
      }
    },
    async saveBatch(batch) {
      const { student } = await binding(batch.candidateId), lease = locks.get(student)
      if (!lease) throw new PostgresReadError('candidate_application_lock_required')
      await lease.query('SELECT 1')
      if (batch.collection?.studentId !== student) throw new PostgresReadError('batch_student_binding_required')
      await db.write(async s => {
        const saved = (await s.query('SELECT classification FROM noco.collection_runs WHERE id=$1', [batch.collection!.runId])).rows[0]?.classification as any
        if (!saved || saved.digest !== batch.collection!.digest) throw new PostgresReadError('saved_classification_required')
        assertCollectionReady(saved, batch.targetIds)
        const previous = (await s.query('SELECT state FROM noco.application_batches WHERE client_id=$1 AND id=$2 FOR UPDATE', [student, batch.id])).rows[0]?.state as BatchState | undefined
        if (previous && (JSON.stringify(previous.targetIds) !== JSON.stringify(batch.targetIds) || previous.limit !== batch.limit || JSON.stringify(previous.collection) !== JSON.stringify(batch.collection) || previous.candidateId !== batch.candidateId)) throw new PostgresReadError('batch_targets_immutable')
        if (previous?.records.some(old => old.status === 'succeeded' && batch.records.find(r => r.position.id === old.position.id)?.status !== 'succeeded')) throw new PostgresReadError('captured_confirmation_cannot_be_downgraded')
        if (batch.targetIds.length > batch.limit || new Set(batch.targetIds).size !== batch.targetIds.length || batch.records.some(r => !batch.targetIds.includes(r.position.id))) throw new PostgresReadError('batch_limit_invalid')
        for (const record of batch.records) {
          const vacancy = (await s.query('SELECT id::text,company_id::text FROM noco.vacancies WHERE canonical_url=$1', [canonicalUrl(record.position.url)])).rows[0]
          if (!vacancy) throw new PostgresReadError('saved_vacancy_required')
          const existing = (await s.query('SELECT id,source FROM noco.applications WHERE client_id=$1 AND vacancy_id=$2', [student, vacancy.id])).rows[0]
          if (existing && (existing.source as any)?.batchId !== batch.id) {
            if (record.status === 'skipped') continue
            throw new PostgresReadError('student_vacancy_already_recorded')
          }
          const statuses = { prepared: 'preparing', submitting: 'submitting', succeeded: 'submitted', failed: 'failed', blocked: 'needs_action', unknown: 'unknown', skipped: 'skipped' }
          const evidence = record.status === 'succeeded' ? record.evidence : undefined
          if (record.status === 'succeeded' && !evidence?.confirmation) throw new PostgresReadError('confirmation_evidence_required')
          await s.query(`INSERT INTO noco.applications(client_id,company_id,vacancy_id,channel,submission_status,reason_code,confirmation_kind,confirmed_at,evidence,source)
            VALUES($1,$2,$3,'external-responses',$4,$5,$6,$7,$8::jsonb,$9::jsonb)
            ON CONFLICT(client_id,vacancy_id) WHERE vacancy_id IS NOT NULL DO UPDATE SET submission_status=excluded.submission_status,
            reason_code=excluded.reason_code,confirmation_kind=excluded.confirmation_kind,confirmed_at=excluded.confirmed_at,evidence=excluded.evidence,source=excluded.source`,
            [student, vacancy.company_id, vacancy.id, statuses[record.status], record.reason ?? null,
              evidence ? evidence.confirmation === 'captured' ? 'captured' : 'candidate_reported' : 'none', evidence?.observedAt ?? null,
              JSON.stringify(redact(record.evidence ?? {})), JSON.stringify({ batchId: batch.id, candidateId: batch.candidateId, manualAssistance: record.manualAssistance ?? null, runId: batch.collection!.runId })])
        }
        await s.query(`INSERT INTO noco.application_batches(client_id,id,state) VALUES($1,$2,$3::json)
          ON CONFLICT(client_id,id) DO UPDATE SET state=excluded.state,updated_at=now()`, [student, batch.id, JSON.stringify(redact(batch))])
      })
      // A failed export cannot turn a committed intent into permission to repeat a submission.
      await local.saveBatch(batch).catch(() => {})
    }
  }
}
