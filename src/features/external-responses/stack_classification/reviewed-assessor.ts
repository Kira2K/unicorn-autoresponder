import { digest } from '../../company-client-management/legacy-snapshot.mts'
import type { VacancyCollection } from '../vacancy_collection/index.ts'
import type { SelectionRules } from './rules.ts'
import type { StackDecision } from './index.ts'
import type { Position } from '../types.ts'
import type { StackProfile } from '../stack_catalog/index.ts'
import { publicationContext } from '../vacancy_collection/posting-content.ts'
import { createAssessmentPrecheck } from './precheck.ts'
import type { ExchangeRates } from './salary.ts'
import { createTitleStackSelector } from '../vacancy_collection/title-precheck.ts'

export type ReviewedAssessments = { runId: string; collectionDigest: string; rulesHash: string; reviewedBy: string; reviewedAt: string; origin: 'assistant_session' | 'human'; decisions: Record<string, { global: StackDecision; stacks: Record<string, StackDecision> }> }
/** Explicit evidence-backed assessment adapter; never disguises manual review as an API model response. */
export function createReviewedAssessors(review: ReviewedAssessments, collection: VacancyCollection, rules: SelectionRules, now = new Date(), rates?: ExchangeRates) {
  if (review.runId !== collection.runId || review.collectionDigest !== digest(collection) || review.rulesHash !== rules.sha256) throw Error('reviewed_assessment_stale')
  if (!review.reviewedBy?.trim() || !['assistant_session', 'human'].includes(review.origin) || !Number.isFinite(Date.parse(review.reviewedAt))) throw Error('reviewed_assessment_provenance_required')
  const ids = new Set(collection.positions.map(p => p.id))
  if (Object.keys(review.decisions).some(id => !ids.has(id))) throw Error('reviewed_assessment_unknown_position')
  const validate = (position: Position, decision?: StackDecision) => {
    if (!decision || !['eligible','excluded','review'].includes(decision.decision) || !decision.reasons?.length || !decision.evidence?.length || decision.evidence.some(text => !text.trim() || ![position.title, position.description, position.location, ...publicationContext(position,now).evidence].some(body => body.includes(text)))) throw Error('reviewed_assessment_evidence_required')
    return structuredClone(decision)
  }
  // Validate the complete record before any SQL promotion or classifier error-to-review conversion.
  const precheck = createAssessmentPrecheck(rules, collection.scope, now, rates)
  const selectStacks=createTitleStackSelector(rules,collection.scope?.stacks??[])
  for (const position of collection.positions) {
    const record = review.decisions[position.id]
    if (!record && precheck(position)) continue
    validate(position, record?.global)
    if (record.global.decision === 'eligible') for (const stack of selectStacks(position.title)) validate(position, record.stacks[stack.id])
  }
  return { provenance: { origin: review.origin, reviewedBy: review.reviewedBy, reviewedAt: review.reviewedAt, reviewHash: digest(review) },
    assessGlobal: async (position: Position) => validate(position, review.decisions[position.id]?.global),
    assess: async (position: Position, stack: StackProfile) => validate(position, review.decisions[position.id]?.stacks[stack.id]) }
}
