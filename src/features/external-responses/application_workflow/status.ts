import type { BatchState } from '../types.ts'
import type { SelectionRules } from '../stack_classification/rules.ts'
import { assertCurrentSelectionRules, decisionRulesHash, semanticRules } from '../stack_classification/rules.ts'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { missingField, nextApplicationAction } from './next-action.ts'
import type { TailoringState } from './tailoring-status.ts'
import { evaluatePublicationDate } from '../vacancy_collection/publication-date-precheck.ts'

/** Small, deterministic work packet; no CV text, answers, browser session or generation. */
export function applicationStatus(input: { candidateId: string; batchId: string; positionIds: string[]; cvMode?: 'original'; campaign?: unknown; preparedAnswers?: Record<string, unknown>; testReviews?: Record<string, { result: string; sha256: string }> }, batch: BatchState | undefined, savedRules: SelectionRules | undefined, currentRules: SelectionRules, tailoring: Record<string, TailoringState> = {}) {
  let ruleStatus = 'compatible'
  try { assertCurrentSelectionRules(savedRules, currentRules) } catch { ruleStatus = 'requires_revalidation' }
  const blocks = (r: SelectionRules) => Object.fromEntries([...r.text.matchAll(/```([a-z-]+-precheck-json)\s*\n([\s\S]*?)```/g)].map(m => [m[1], digest(JSON.parse(m[2]))]))
  const previous = savedRules ? blocks(savedRules) : {}, current = blocks(currentRules)
  const changedChecks = [...new Set([...Object.keys(previous), ...Object.keys(current)])].filter(k => previous[k] !== current[k])
  const targets = input.positionIds.map(id => {
    const r = batch?.records.find(r => r.position.id === id), review = input.testReviews?.[id] ?? r?.preparedCv?.testReview
    let next: string = nextApplicationAction(r, { rulesCompatible: ruleStatus === 'compatible', campaign: input.campaign, review, tailoring: tailoring[id], cvMode: input.cvMode,
      originalCvAllowed: !batch?.cvSelection && !batch?.records.some(record => record.attempt > 0) || batch?.cvSelection?.mode === 'original' })
    const publication = r?.position ? evaluatePublicationDate({ ...r.position, description: r.position.description ?? '' }, currentRules) : undefined
    if (next !== 'none' && next !== 'reconcile_existing_attempt') {
      if (publication?.decision === 'excluded') next = 'exclude_expired_posting'
      else if (publication?.decision === 'inspect') next = 'review_publication_date'
    }
    return { id, title: r?.position.title, status: r?.status ?? 'not_prepared', reason: r?.reason, attempt: r?.attempt ?? 0,
      next, publication, engine: r?.preparation?.engine, formSignature: r?.preparation?.formSignature, cachedQuestions: Object.keys(r?.preparation?.fields ?? {}).length,
      missingQuestions: r?.answers?.missing.map(missingField) ?? [], tailoring: tailoring[id], cv: r?.preparedCv ? { path: r.preparedCv.path, sha256: r.preparedCv.sha256, review: review?.result } : undefined }
  })
  return { version: 1, candidateId: input.candidateId, batchId: input.batchId, cvMode: input.cvMode ?? 'tailored', cvSelection: batch?.cvSelection, rules: { status: ruleStatus, currentHash: decisionRulesHash(currentRules), changedChecks,
    semanticTextChanged: !savedRules || semanticRules(savedRules) !== semanticRules(currentRules) }, scopedAnswerOverrides: Object.keys(input.preparedAnswers ?? {}).length, targets,
    policy: 'Read-only checkpoint. Inspect current fields, eligibility and attachment before writes; uncertain attempts reconcile without a new submit.' }
}
