import { isDuplicate, canonicalUrl } from '../infrastructure/identity.ts'
import { verifiedUploadOnlyDrift } from './form-fields.ts'
import { diagnostic, redact } from '../infrastructure/store.ts'
import { allowsAiAssistedSubmission } from './employer-policy.ts'
import { assertPreparedCv } from '../application_preparation/tailoring.ts'
import { prepareWithCheckpoint } from '../application_preparation/checkpoint.ts'
import { assertOriginalCv, assertOriginalCvApproval } from '../application_preparation/original-cv.ts'
import type { OriginalCvApproval } from '../application_preparation/original-cv.ts'
import type { PreparedCv } from '../application_preparation/tailoring.ts'
import type { Candidate, Position, Store, ApplicationAdapter, AnswerGenerator, VerificationHandler, BatchState, ApplicationRecord, HistoryEntry, Outcome, EmployerAiException, RetryAuthorization, ApplicationFormMemory } from '../types.ts'

const now = () => new Date().toISOString()
export async function applyToPositions(input: {
  candidate: Candidate; batchId: string; positions: Position[]; mode: 'dry-run' | 'live'; limit: number; resume?: boolean; manualSubmit?: boolean; reviewOverride?: string; employerAiExceptions?: Record<string, EmployerAiException>; collection?:BatchState['collection']; preparedCvs?: Record<string, PreparedCv>; requireTailoredCv?: boolean; cvMode?: 'original'; originalCvApproval?: OriginalCvApproval; testCampaign?: BatchState['testCampaign']; retryAuthorizations?: Record<string, RetryAuthorization>; humanAssistance?: Record<string, NonNullable<ApplicationRecord['humanAssistance']>>
}, deps: { store: Store; adapters: ApplicationAdapter[]; answers: AnswerGenerator; verification?: VerificationHandler; formMemory?: ApplicationFormMemory; eligibility?: (candidate: Candidate, position: Position) => Promise<Pick<Position, 'fit' | 'restrictionChecks'>> }): Promise<BatchState> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || !input.positions.length || input.positions.length > input.limit) throw Error('Application target limit exceeded or empty targets')
  if (input.cvMode === 'original') {
    assertOriginalCvApproval(input.originalCvApproval)
    if (input.requireTailoredCv || input.testCampaign) throw Error('original_cv_conflicts_with_tailored_gate')
    await assertOriginalCv(input.candidate)
  }
  if (new Set(input.positions.map(p => p.id)).size !== input.positions.length) throw Error('Duplicate targets in batch')
  for (const [id, assistance] of Object.entries(input.humanAssistance ?? {})) {
    if (!input.positions.some(p => p.id === id) || !Number.isFinite(Date.parse(assistance.observedAt)) || !assistance.reference?.trim()) throw Error('human_assistance_evidence_required')
  }
  for (const [id, approval] of Object.entries(input.retryAuthorizations ?? {})) {
    if (approval.candidateId !== input.candidate.id || approval.batchId !== input.batchId || approval.positionId !== id || !input.positions.some(p => p.id === id) || !Number.isInteger(approval.afterAttempt) || approval.afterAttempt < 1 || !Number.isFinite(Date.parse(approval.approvedAt)) || !approval.approvalReference.trim()) throw Error('retry_authorization_scope_mismatch')
  }
  const release = await deps.store.lock(input.candidate.id)
  try {
    const stored = await deps.store.batch(input.candidate.id, input.batchId)
    if(stored?.collection && JSON.stringify(stored.collection)!==JSON.stringify(input.collection))throw Error('Batch collection and stack are immutable')
    const targets = input.positions.map(p => p.id)
    if (stored && (stored.limit !== input.limit || JSON.stringify(stored.targetIds) !== JSON.stringify(targets))) throw Error('Batch target list and limit are immutable; replacements are not authorized')
    if (stored && stored.records.some(r => { const incoming = input.positions.find(p => p.id === r.position.id); return incoming && (canonicalUrl(incoming.url) !== canonicalUrl(r.position.url) || canonicalUrl(incoming.applyUrl) !== canonicalUrl(r.position.applyUrl)) })) throw Error('Batch target URLs are immutable')
    if (stored && !input.resume && stored.records.some(r => r.status !== 'prepared')) throw Error('Batch exists: use --resume')
    if (input.cvMode === 'original') {
      if (stored?.cvSelection && JSON.stringify(stored.cvSelection) !== JSON.stringify({ mode: 'original', path: input.candidate.cv.path, sha256: input.candidate.cv.sha256, approval: input.originalCvApproval })) throw Error('original_cv_selection_changed')
      if (!stored?.cvSelection && stored?.records.some(r => r.attempt > 0)) throw Error('attempted_attachment_mode_immutable')
    } else if (stored?.cvSelection) throw Error('original_cv_selection_immutable')
    const batch: BatchState = stored ?? { id: input.batchId, candidateId: input.candidate.id, targetIds: targets, limit: input.limit, records: [], createdAt: now(), updatedAt: now() }
    if (input.cvMode === 'original') batch.cvSelection = { mode: 'original', path: input.candidate.cv.path, sha256: input.candidate.cv.sha256, approval: input.originalCvApproval! }
    if(input.collection)batch.collection={...input.collection}
    if (stored?.testCampaign && JSON.stringify(stored.testCampaign) !== JSON.stringify(input.testCampaign)) throw Error('test_campaign_binding_changed')
    if (input.testCampaign) batch.testCampaign = input.testCampaign
    const save = async () => {
      batch.updatedAt = now(); await deps.store.saveBatch(batch)
      await diagnostic(deps.store, { at: batch.updatedAt, candidateId: input.candidate.id, runId: batch.id, action: 'batch_checkpoint', data: { targets: batch.targetIds, states: batch.records.map(r => ({ positionId: r.position.id, status: r.status, reason: r.reason, attempt: r.attempt })) } })
    }
    await save()
    for (const position of input.positions) {
      let record = batch.records.find(r => r.position.id === position.id)
      if (record && input.humanAssistance?.[position.id]) {
        record.humanAssistance = { ...input.humanAssistance[position.id] }; record.manualAssistance = true; await save()
      }
      const recheckDuplicate = record?.status === 'skipped' && record.reason === 'already_applied' && record.attempt === 0
      if (record && ['succeeded', 'skipped'].includes(record.status) && !recheckDuplicate) continue
      const history: HistoryEntry[] = [...(await deps.store.candidate(input.candidate.id)).history, ...input.candidate.history]
      for (const previous of await deps.store.batches(input.candidate.id)) for (const r of previous.records) {
        if (previous.id === batch.id && r.position.id === position.id) continue
        if (['succeeded', 'submitting', 'unknown'].includes(r.status)) history.push({ ...r.position, status: r.status === 'succeeded' ? 'succeeded' : 'unknown', date: r.updatedAt })
      }
      if (!record) { record = { position, status: 'prepared', detail: 'Preparing application', attempt: 0, updatedAt: now() }; batch.records.push(record) }
      if (input.humanAssistance?.[position.id]) { record.humanAssistance = { ...input.humanAssistance[position.id] }; record.manualAssistance = true }
      const artifact = input.cvMode === 'original' ? undefined : input.preparedCvs?.[position.id] ?? record.preparedCv
      if (record.preparedCv && artifact && record.preparedCv.sha256 !== artifact.sha256) throw Error('prepared_cv_immutable')
      if (artifact) { if (artifact.batchId !== batch.id) throw Error('prepared_cv_batch_binding_mismatch'); await assertPreparedCv(artifact, input.candidate, position); record.preparedCv = artifact }
      record.position = position
      if (input.reviewOverride?.trim()) record.reviewOverride = input.reviewOverride.trim()
      if (input.employerAiExceptions?.[position.id]) record.employerAiException = { ...input.employerAiExceptions[position.id] }
      if (record.attempt && ['succeeded', 'failed', 'blocked', 'unknown'].includes(record.status) && !record.outcomes?.some(o => o.attempt === record!.attempt)) {
        record.outcomes = [...(record.outcomes ?? []), { status: record.status as Outcome['status'], reason: record.reason, detail: record.detail, evidence: record.evidence, manualAssistance: record.manualAssistance, attempt: record.attempt }]
      }
      const log = (action: string, data?: Record<string, unknown>) => diagnostic(deps.store, { at: now(), candidateId: input.candidate.id, runId: batch.id, positionId: position.id, attempt: record!.attempt, action, data })
      if (isDuplicate(position, history)) { Object.assign(record, { status: 'skipped', reason: 'already_applied', detail: 'Blocked by existing submission or skip history.' }); await save(); continue }
      if (recheckDuplicate) {
        Object.assign(record, { status: 'prepared', reason: undefined, detail: 'Distinct posting confirmed by current duplicate check.' })
        await save(); await log('duplicate_reconciled', { previousReason: 'already_applied', attempt: 0 })
      }
      const awaitingReceipt = ['submitting', 'unknown'].includes(record.status)
      const checkEligibility = async () => {
        if (!deps.eligibility) return true
        try { Object.assign(position, await deps.eligibility(input.candidate, position)) }
        catch { position.fit = { decision: 'review', reasons: ['Current student membership or restrictions unavailable'], evidence: [] }; position.restrictionChecks = [] }
        if (position.fit?.decision === 'eligible') return true
        Object.assign(record, { status: 'blocked', reason: position.fit?.decision === 'excluded' ? 'restriction_applies' : 'restriction_review', detail: position.fit?.reasons.join('; ') ?? 'Restriction review required' })
        await save(); await log('student_restriction_blocked', { reason: record.reason, checks: position.restrictionChecks }); return false
      }
      if (!awaitingReceipt && !await checkEligibility()) continue
      if (!awaitingReceipt && position.fit?.decision !== 'eligible' && !record.reviewOverride) { Object.assign(record, { status: 'blocked', reason: 'input_required', detail: 'Vacancy fit needs explicit evidence-based review. ' + (position.fit?.reasons.join('; ') ?? '') }); await save(); continue }
      const adapter = deps.adapters.find(a => a.supports(position))
      if (!adapter) {
        if (!awaitingReceipt) Object.assign(record, { status: 'blocked', reason: 'unsupported_form', detail: 'No supported application adapter; manual handoff.' })
        await save(); continue
      }
      let session
      try {
        for (let preflight = 0; preflight < 2; preflight++) {
          try { session = await adapter.open(position); break }
          catch (error) { if (preflight === 1) throw error; await log('open_retry'); await new Promise(r => setTimeout(r, 700)) }
        }
      }
      catch (error) {
        const cause = redact(error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, '[url]').slice(0, 300)
        await log('application_open_failed', { positionId: position.id, cause })
        if (!['unknown', 'submitting'].includes(record.status)) {
          const reason = cause === 'posting_closed' ? 'posting_closed' : cause === 'posting_expired' ? 'restriction_applies' : ['posting_publication_review_required', 'posting_content_review_required'].includes(cause) ? 'restriction_review' : 'network_error'
          const detail = cause === 'posting_expired' ? 'Current official first publication date exceeds the shared vacancy age rule.' : cause === 'posting_closed' ? 'Official ATS no longer lists this application.' : cause === 'posting_publication_review_required' ? 'Current official first publication date needs review.' : cause === 'posting_content_review_required' ? 'Current official posting differs from the scoped review or has no compatible review.' : 'Could not open application page.'
          Object.assign(record, { status: 'blocked', reason, detail })
        }
        await save(); continue
      }
      if (!session) throw Error('Application adapter did not return a session')
      let keepOpen = false
      try {
        const reconcile = async (): Promise<Outcome> => {
          const observed = await session.reconcile().catch((): Outcome => ({ status: 'unknown', reason: 'unknown_outcome', detail: 'Receipt inspection unavailable.' }))
          if (observed.status === 'succeeded' || input.mode !== 'live' || !record.attempt || !session.continueAfterCaptcha) return observed
          // This optional adapter operation is bound to a retained live tab; it must never infer readiness from an absent puzzle.
          return session.continueAfterCaptcha(async () => {
            if (!record.answers || !await checkEligibility()) return false
            if (input.requireTailoredCv && !record.preparedCv) return false
            if (input.cvMode === 'original') await assertOriginalCv(input.candidate)
            else if (record.preparedCv) await assertPreparedCv(record.preparedCv, input.candidate, position)
            if (input.testCampaign && (record.preparedCv?.testReview?.result !== 'passed' || record.preparedCv.testReview.sha256 !== record.preparedCv.sha256)) return false
            const uploadCandidate = input.cvMode !== 'original' && record.preparedCv ? { ...input.candidate, cv: { path: record.preparedCv.path, sha256: record.preparedCv.sha256, fileName: record.preparedCv.fileName } } : input.candidate
            const fresh = await session.inspect()
            if (fresh.closed || fresh.gate || fresh.aiBan && !allowsAiAssistedSubmission(fresh, record.employerAiException, record.answers)) return false
            if (!record.fields) return false
            if ((await session.verify(uploadCandidate, record.answers)).length) return false
            if (JSON.stringify(fresh.fields) !== JSON.stringify(record.fields) && !verifiedUploadOnlyDrift(record.fields, fresh.fields, session.verifiedUploadKeys?.() ?? [])) return false
            record.status = 'submitting'; record.detail = 'Durable continuation intent for the same verified form and submission attempt'; record.updatedAt = now()
            await save(); await log('verification_continuation_intent')
            return true
          }).catch((): Outcome => ({ status: 'unknown', reason: 'unknown_outcome', detail: 'Verification continuation interrupted; reconcile before retrying.' }))
        }
        if (input.resume && ['blocked', 'failed'].includes(record.status)) {
          const observed = await reconcile()
          if (observed.status === 'succeeded' && observed.evidence?.confirmation) { Object.assign(record, observed, { reason: undefined, updatedAt: now() }); await save(); await log('application_reconciled'); continue }
          if (record.attempt > 0 && observed.reason === 'captcha_required') { Object.assign(record, observed); keepOpen = true; await save(); await deps.verification?.queue(record, batch); continue }
          if (record.attempt > 0 && observed.reason === 'email_verification_required') { Object.assign(record, observed); keepOpen = true; await save(); await deps.verification?.queue(record, batch); continue }
          if (record.attempt > 0 && record.reason === 'email_verification_required' && observed.status === 'unknown') { keepOpen = true; await save(); continue }
          if (record.attempt > 0 && observed.status === 'unknown' && !input.manualSubmit) {
            Object.assign(record, { status: 'unknown', reason: 'unknown_outcome', detail: 'The handed-off attempt may have changed externally. No receipt or current rejection is visible; do not resubmit.' }); keepOpen = true; await save(); continue
          }
        }
        if (['submitting', 'unknown'].includes(record.status)) {
          const outcome = await reconcile()
          const approval = input.retryAuthorizations?.[position.id]
          if (outcome.status === 'succeeded' && outcome.evidence?.confirmation) { Object.assign(record, outcome, { reason: undefined, updatedAt: now() }); await save(); await log('application_reconciled', { status: record.status }); continue }
          if (outcome.reason === 'captcha_required') {
            Object.assign(record, { status: 'unknown', reason: 'unknown_outcome', detail: 'Prior submission remains unconfirmed; a CAPTCHA is visible. Continue verification, not a new submission.', evidence: outcome.evidence ?? record.evidence })
            keepOpen = true; await save(); await deps.verification?.queue(record, batch); continue
          }
          if (outcome.reason === 'email_verification_required') {
            Object.assign(record, { status: 'blocked', reason: 'email_verification_required', detail: outcome.detail, evidence: outcome.evidence ?? record.evidence })
            keepOpen = true; await save(); await log('email_verification_handoff', { status: record.status, attempt: record.attempt }); await deps.verification?.queue(record, batch); continue
          }
          if (!approval || approval.afterAttempt !== record.attempt) {
            Object.assign(record, { status: 'unknown', reason: 'unknown_outcome', detail: 'Prior submission remains unconfirmed. Reconcile a receipt; do not resubmit.', evidence: outcome.evidence ?? record.evidence })
            keepOpen = true; await save(); await log('application_reconciled', { status: record.status }); continue
          }
          // Explicit new operator instruction, never an automatic retry. Earlier uncertainty stays in outcomes.
          record.retryAuthorizations = [...(record.retryAuthorizations ?? []), approval]
          Object.assign(record, { status: 'prepared', reason: undefined, detail: 'Operator explicitly authorized one additional attempt after an unresolved outcome.' })
          await save(); await log('operator_retry_authorized', { approval, previousOutcome: 'unknown' })
          if (!await checkEligibility()) continue
        }
        let inspection
        try { inspection = await session.inspect() }
        catch { Object.assign(record, { status: 'blocked', reason: 'unsupported_form', detail: 'Form inspection failed; review the preserved tab.' }); keepOpen = true; await save(); continue }
        record.fields = inspection.fields
        if (deps.formMemory) {
          try { await log('application_engine_memory', { engine: `${adapter.name}@${adapter.version ?? 'unversioned'}`, schema: await deps.formMemory.inspect(position, `${adapter.name}@${adapter.version ?? 'unversioned'}`, inspection.fields) }) }
          catch { await log('application_engine_memory_unavailable') }
        }
        if (inspection.gate) { Object.assign(record, { status: 'blocked', reason: inspection.gate, detail: 'Employer verification gate encountered before form preparation.' }); keepOpen = true; await save(); await deps.verification?.queue(record, batch); continue }
        if (inspection.closed || inspection.aiBan && !allowsAiAssistedSubmission(inspection, record.employerAiException)) {
          Object.assign(record, { status: 'blocked', reason: inspection.closed ? 'posting_closed' : 'employer_ai_ban', detail: inspection.closed ? 'Posting no longer accepts applications.' : 'Employer prohibits AI assistance; candidate must complete the application.' }); await save(); continue
        }
        const days = inspection.minimumDaysBetweenApplications
        const previousAtEmployer = history.filter(h => h.company.trim().toLowerCase() === position.company.trim().toLowerCase() && ['succeeded', 'unknown'].includes(h.status))
        if (days && previousAtEmployer.some(h => !h.date || !Number.isFinite(Date.parse(h.date)) || Date.now() - Date.parse(h.date) < days * 86400000)) {
          Object.assign(record, { status: 'blocked', reason: 'employer_cooldown', detail: `Employer permits one application per ${days} days; imported or current application history is inside this window or has an unknown date.` }); await save(); await log('employer_cooldown', { days }); continue
        }
        try {
          const prepared = await prepareWithCheckpoint({ candidate: input.candidate, position, form: inspection, engine: `${adapter.name}@${adapter.version ?? 'unversioned'}`, previous: record.preparation }, deps.answers)
          record.answers = prepared.answers; record.preparation = prepared.checkpoint
          await log('answer_reuse', { reusedFields: prepared.reused, generatedFields: prepared.generated, engine: prepared.checkpoint.engine, formSignature: prepared.checkpoint.formSignature })
        }
        catch { Object.assign(record, { status: 'blocked', reason: 'input_required', detail: 'Answer generation unavailable; provide confirmed answers and resume.' }); keepOpen = true; await save(); continue }
        await log('answers_prepared', { fields: inspection.fields.map(f => f.label), missing: record.answers.missing.map(f => f.label) })
        if (inspection.aiBan && !allowsAiAssistedSubmission(inspection, record.employerAiException, record.answers)) {
          Object.assign(record, { status: 'blocked', reason: 'employer_ai_ban', detail: 'An explicitly authorized AI-assisted retry must answer No to the employer own-words declaration.' }); await save(); continue
        }
        if (inspection.aiBan) await log('employer_ai_exception', { ...record.employerAiException, declarationAnswer: 'No', consequence: 'Employer may disqualify AI-assisted application' })
        if (record.answers.missing.length) { Object.assign(record, { status: 'blocked', reason: 'input_required', detail: 'Missing confirmed answers: ' + record.answers.missing.map(f => f.label).join('; ') }); keepOpen = true; await save(); await deps.verification?.queue(record, batch); continue }
        if (input.mode === 'dry-run') { Object.assign(record, { status: 'prepared', reason: undefined, detail: 'Dry run prepared; no candidate data uploaded.' }); await save(); continue }
        if (input.requireTailoredCv && !record.preparedCv) { Object.assign(record, { status: 'blocked', reason: 'input_required', detail: 'A vacancy-specific tailored CV is required; original upload is forbidden.' }); await save(); continue }
        if (input.testCampaign && record.preparedCv && (record.preparedCv.testReview?.result !== 'passed' || record.preparedCv.testReview.sha256 !== record.preparedCv.sha256)) { Object.assign(record, { status: 'blocked', reason: 'input_required', detail: record.preparedCv.testReview?.result === 'failed' ? `test_cv_review_failed: ${record.preparedCv.testReview.evidence}` : 'test_cv_review_required: returned PDF is saved in the report; no upload before this test validates it.' }); await save(); continue }
        if (!await checkEligibility()) continue
        try {
          if (input.cvMode === 'original') await assertOriginalCv(input.candidate)
          else if (record.preparedCv) await assertPreparedCv(record.preparedCv, input.candidate, position)
          const uploadCandidate = input.cvMode !== 'original' && record.preparedCv ? { ...input.candidate, cv: { path: record.preparedCv.path, sha256: record.preparedCv.sha256, fileName: record.preparedCv.fileName } } : input.candidate
          await session.fill(uploadCandidate, record.answers)
          const errors = await session.verify(uploadCandidate, record.answers)
          if (errors.length) { Object.assign(record, { status: 'blocked', reason: 'validation_error', detail: errors.join('; ') }); keepOpen = true; await save(); await deps.verification?.queue(record, batch); continue }
          const fresh = await session.inspect()
          if (fresh.closed || fresh.aiBan && !allowsAiAssistedSubmission(fresh, record.employerAiException, record.answers)) { Object.assign(record, { status: 'blocked', reason: fresh.closed ? 'posting_closed' : 'employer_ai_ban', detail: 'Availability or employer application requirements changed before submission.' }); keepOpen = true; await save(); continue }
          if (JSON.stringify(fresh.fields) !== JSON.stringify(inspection.fields) && !verifiedUploadOnlyDrift(inspection.fields, fresh.fields, session.verifiedUploadKeys?.() ?? [])) {
            const before = new Map(inspection.fields.map(field => [field.key, field]))
            const after = new Map(fresh.fields.map(field => [field.key, field]))
            const added = fresh.fields.filter(field => !before.has(field.key)).map(field => ({ key: field.key, type: field.type, required: field.required }))
            const removed = inspection.fields.filter(field => !after.has(field.key)).map(field => ({ key: field.key, type: field.type, required: field.required }))
            const changed = fresh.fields.filter(field => before.has(field.key) && JSON.stringify(before.get(field.key)) !== JSON.stringify(field)).map(field => field.key)
            await log('form_questions_changed_during_fill', { positionId: position.id, added, removed, changed })
            Object.assign(record, { status: 'blocked', reason: 'validation_error', detail: 'Form questions changed during fill. Resume to prepare only the changed questions.' }); keepOpen = true; await save(); continue
          }
          if (record.preparation) record.preparation.verifiedAt = now()
          if (deps.formMemory) {
            try { await deps.formMemory.verified(position, `${adapter.name}@${adapter.version ?? 'unversioned'}`, fresh.fields, now()) }
            catch { await log('application_engine_memory_save_failed') }
          }
        } catch (error) {
          const detail = redact(error instanceof Error ? error.message : String(error)).slice(0, 1600)
          Object.assign(record, { status: 'blocked', reason: 'validation_error', detail: `Could not fill and verify every answer. No submission was attempted. ${detail.split('\n')[0]}` })
          await log('form_preparation_failed', { error: detail })
          keepOpen = true; await save(); continue
        }
        // A failed intent write must propagate. Never put this inside the submit catch.
        if (!await checkEligibility()) continue
        record.status = 'submitting'; record.reason = undefined; record.detail = 'Durable submission intent'; record.attempt++; record.updatedAt = now(); await save()
        await log('submission_intent')
        if (input.manualSubmit) {
          record.manualAssistance = true; record.detail = 'Fields and attachment verified. Durable intent saved; awaiting the candidate to click Submit in the preserved tab.'
          keepOpen = true; await save(); await deps.verification?.queue(record, batch); continue
        }
        let outcome: Outcome
        try { outcome = await session.submit() }
        catch { outcome = { status: 'unknown', reason: 'unknown_outcome', detail: 'Submission interrupted; reconcile before retrying.' } }
        record.status = outcome.status
        Object.assign(record, outcome, { updatedAt: now() })
        if (record.status === 'succeeded' && !record.evidence?.confirmation) Object.assign(record, { status: 'unknown', reason: 'unknown_outcome', detail: 'Adapter returned success without confirmation evidence.' })
        record.outcomes = [...(record.outcomes ?? []), { status: record.status as Outcome['status'], reason: record.reason, detail: record.detail, evidence: record.evidence, manualAssistance: record.manualAssistance, attempt: record.attempt }]
        keepOpen = record.status !== 'succeeded'; await save()
        await log('application_outcome', { status: record.status, reason: record.reason, evidence: record.evidence })
        if (keepOpen) await deps.verification?.queue(record, batch)
      } finally { if (!keepOpen) await session.close().catch(() => {}) }
    }
    return batch
  } finally { await release() }
}
