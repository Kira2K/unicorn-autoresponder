import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRuntimeDatabase } from '../infrastructure/postgres.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'
import { applicationStatus } from './status.ts'
import type { BatchState } from '../types.ts'
import { readTailoringStates } from './tailoring-status.ts'
import { assertOriginalCvApproval } from '../application_preparation/original-cv.ts'
import { applicationWorkerPacket } from './worker-packet.ts'
import { loadLatestPublicationEvidence, withLatestPublicationEvidence } from '../vacancy_collection/publication-memory.ts'

export async function applicationStatusCommand(args: string[]) {
  const path = args[args.indexOf('--input') + 1]
  if (!args.includes('--input') || !path || args.includes('--live')) throw Error('application_status_requires_input_and_is_read_only')
  const input = JSON.parse(await readFile(resolve(path), 'utf8')), db = createRuntimeDatabase()
  try {
    if (!input.studentId || !input.candidateId || !input.batchId || !input.collectionRunId || !Array.isArray(input.positionIds)) throw Error('application_status_input_invalid')
    if (input.cvMode === 'original') assertOriginalCvApproval(input.originalCvApproval)
    else if (input.cvMode !== undefined) throw Error('unsupported_cv_mode')
    const saved = await db.read(async s => ({ batch: (await s.query('SELECT state FROM noco.application_batches WHERE client_id=$1 AND id=$2', [String(input.studentId), input.batchId])).rows[0]?.state as BatchState | undefined,
      rules: (await s.query('SELECT classification FROM noco.collection_runs WHERE id=$1', [input.collectionRunId])).rows[0]?.classification as any }))
    if (saved.batch && saved.batch.candidateId !== input.candidateId) throw Error('batch_student_binding_mismatch')
    if (saved.batch && (JSON.stringify(saved.batch.targetIds) !== JSON.stringify(input.positionIds) || saved.batch.collection?.runId !== input.collectionRunId)) throw Error('batch_scope_changed')
    const storage = args.includes('--storage') ? args[args.indexOf('--storage') + 1] : 'storage/external-responses'
    if (!storage) throw Error('application_status_storage_required')
    if (saved.batch) {
      const positions = saved.batch.records.map(r => r.position)
      const fresh = withLatestPublicationEvidence(positions, await loadLatestPublicationEvidence(positions, db.read))
      saved.batch = { ...saved.batch, records: saved.batch.records.map((r, i) => ({ ...r, position: fresh[i] })) }
    }
    const tailoring = input.cvMode === 'original' ? {} : await readTailoringStates(input, saved.batch, storage)
    const status = applicationStatus(input, saved.batch, saved.rules?.selectionRules, await loadSelectionRules(), tailoring)
    const positionId = args.includes('--position') ? args[args.indexOf('--position') + 1] : undefined
    if (args.includes('--position') && (!positionId || !status.targets.some(t => t.id === positionId))) throw Error('status_position_outside_batch')
    const result = args.includes('--worker-packet') ? applicationWorkerPacket(status, resolve(path), positionId)
      : positionId ? { ...status, targets: status.targets.filter(t => t.id === positionId) } : status
    console.log(JSON.stringify(result, null, args.includes('--worker-packet') ? undefined : 2))
  } finally { await db.close() }
}
