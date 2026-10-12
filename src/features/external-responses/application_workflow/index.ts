import type { ApplicationInput } from '../applications/index.ts'
import { applyToPositions } from '../applications/index.ts'
import { assertCurrentSelectionRules } from '../stack_classification/rules.ts'
import type { SelectionRules } from '../stack_classification/rules.ts'
import { descriptionMarket } from '../vacancy_collection/description-market.ts'
import { tailorCv, assertPreparedCv } from '../application_preparation/tailoring.ts'
import type { PreparedCv, TailoringPolicy } from '../application_preparation/tailoring.ts'
import type { BatchState, Position } from '../types.ts'
import { reusableBatch } from './resume.ts'
import { assertOriginalCv, assertOriginalCvApproval } from '../application_preparation/original-cv.ts'
import type { OriginalCvApproval } from '../application_preparation/original-cv.ts'

export type WorkflowInput = ApplicationInput & { market: 'en' | 'ru'; stage?: 'prepare' | 'tailor' | 'apply' | 'run'; tailoringPolicy: TailoringPolicy; cvMode?: 'original'; originalCvApproval?: OriginalCvApproval; testReviews?: Record<string, NonNullable<PreparedCv['testReview']>> }
type Dependencies = Parameters<typeof applyToPositions>[1] & { rules: SelectionRules; tailor: (position: Position) => Promise<PreparedCv>; event: (event: Record<string, unknown>) => Promise<void> }
/** Sequential composition only. SQL/ATS/tailoring remain injected independently callable stages. */
export async function runApplication(input: WorkflowInput, deps: Dependencies): Promise<BatchState> {
  if (input.cvMode === 'original') {
    assertOriginalCvApproval(input.originalCvApproval)
    if (input.testCampaign || input.stage === 'tailor') throw Error('original_cv_stage_or_campaign_unsupported')
    await assertOriginalCv(input.candidate)
  } else if (input.cvMode !== undefined) throw Error('unsupported_cv_mode')
  assertCurrentSelectionRules(input.collection.selectionRules, deps.rules)
  for (const position of input.positions) {
    const market = descriptionMarket(position.description).value
    if (market !== (input.market === 'en' ? 'global' : 'ru')) throw Error('student_vacancy_market_mismatch')
  }
  const common = { ...input, requireTailoredCv: input.cvMode !== 'original' }
  const saved = input.resume ? await deps.store.batch(input.candidate.id, input.batchId) : undefined
  if (saved?.cvSelection && input.cvMode !== 'original') throw Error('original_cv_selection_immutable')
  if (input.cvMode === 'original' && saved?.records.some(r => r.attempt > 0) && !saved.cvSelection) throw Error('attempted_attachment_mode_immutable')
  const reused = input.mode === 'live' && input.stage !== 'prepare' && reusableBatch(input, saved)
  let batch = reused ? saved! : await applyToPositions({ ...common, mode: 'dry-run' }, deps)
  if (reused) await deps.event({ action: 'application_checkpoint_reused', batchId: batch.id, targets: batch.targetIds })
  if (input.stage === 'prepare' || input.mode === 'dry-run') return batch
  if (input.cvMode === 'original') return applyToPositions({ ...common, mode: 'live', resume: true }, deps)
  const preparedCvs: Record<string, PreparedCv> = {}
  for (const record of batch.records) {
    if (record.attempt > 0 || !['prepared', 'blocked'].includes(record.status) || !record.answers || record.answers.missing.length) continue
    try {
      let cv = record.preparedCv
      if (!cv) {
        if (input.stage === 'apply') throw Error('tailor_stage_required')
        cv = await deps.tailor(record.position)
      }
      await assertPreparedCv(cv, input.candidate, record.position)
      if (cv.policy.id !== input.tailoringPolicy.id) throw Error('tailoring_policy_changed')
      record.preparedCv = cv // retain returned artifact in the report even when test review blocks upload
      if (input.testCampaign) {
        const review = input.testReviews?.[record.position.id] ?? cv.testReview
        if (!review || review.sha256 !== cv.sha256 || !review.evidence.trim() || !Number.isFinite(Date.parse(review.reviewedAt))) throw Error('test_cv_review_required')
        cv = { ...cv, testReview: review }
        record.preparedCv = cv
        if (review.result !== 'passed') throw Error('test_cv_review_failed')
      }
      preparedCvs[record.position.id] = cv; record.preparedCv = cv
      await deps.event({ action: 'tailored_cv_ready', positionId: record.position.id, artifact: cv })
    } catch (error: any) {
      record.detail = `Preparation blocked: ${error.message}`
      await deps.event({ action: 'tailoring_blocked', positionId: record.position.id, detail: record.detail })
    }
  }
  const release = await deps.store.lock(input.candidate.id)
  try { await deps.store.saveBatch(batch) } finally { await release() }
  if (input.stage === 'tailor') return batch
  // Missing reviewed artifacts remain blocked by the normal application gate; eligible siblings continue.
  return applyToPositions({ ...common, mode: 'live', resume: true, preparedCvs }, deps)
}
