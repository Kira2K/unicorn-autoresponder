import { applyToPositions as executeApplications } from './execute.ts'
import { assertCollectionReady } from '../stack_classification/index.ts'
import type { ClassifiedCollection } from '../stack_classification/index.ts'
import { assertAllowedUrl } from '../infrastructure/navigation-policy.ts'
import { canonicalUrl } from '../infrastructure/identity.ts'
import { assertCampaignStudent } from '../stack_catalog/campaign.ts'
import { evaluateRestrictions } from '../candidate_matching/restrictions.ts'
import type { RestrictionPolicy } from '../candidate_matching/restrictions.ts'
import { studentEligibilityContext } from '../candidate_matching/student-context.ts'
import { telegramOnly } from '../vacancy_collection/application-destinations.ts'
import { higherSeniorityGate } from '../candidate_matching/seniority.ts'
export type ApplicationInput = Omit<Parameters<typeof executeApplications>[0], 'collection'> & { collection: ClassifiedCollection; stackId: string }
/** Public application stage: no form can open until the complete stack collection is ready. */
export function validateApplicationSelection(input: ApplicationInput) {
  assertCollectionReady(input.collection, input.positions.map(p => p.id))
  if (!Number.isInteger(input.limit) || input.limit < 1 || !input.positions.length || input.positions.length > input.limit) throw Error('Application target limit exceeded or empty targets')
  if (new Set(input.positions.map(position => position.id)).size !== input.positions.length) throw Error('Duplicate targets in batch')
  if (input.collection.collection.scope) assertCampaignStudent(input.collection.collection.scope, input.stackId, input.candidate.databaseClientId)
  else if (!input.candidate.stackIds?.includes(input.stackId)) throw Error('candidate_stack_mismatch: assign the student to this stack first')
  if (input.mode === 'live' && !input.collection.collection.scope) throw Error('database_campaign_scope_required')
  const group = input.collection.groups[input.stackId]
  if (!group) throw Error('stack_not_collected')
  for (const position of input.positions) {
    assertAllowedUrl(position.url); assertAllowedUrl(position.applyUrl)
    if (!group.matchedIds.includes(position.id)) throw Error('vacancy_not_eligible_for_stack')
    const original = input.collection.collection.positions.find(row => row.id === position.id)
    if (!original || canonicalUrl(original.url) !== canonicalUrl(position.url) || canonicalUrl(original.applyUrl) !== canonicalUrl(position.applyUrl) || original.title !== position.title || original.description !== position.description || original.company !== position.company || original.location !== position.location || JSON.stringify(original.source.database) !== JSON.stringify(position.source.database)) throw Error('collection_position_changed')
    if ([original.source, ...(original.sources ?? [])].some(s => s.database?.applicationRoute === 'notify_only')) throw Error('company_report_only')
    if (telegramOnly(original)) throw Error('vacancy_deferred_to_telegram: use the later Telegram workflow')
    if (higherSeniorityGate(original.title, input.candidate.seniorityExceptions).decision === 'excluded') throw Error('higher_seniority_exception_required')
  }
}
export async function applyToPositions(input: ApplicationInput, deps: Parameters<typeof executeApplications>[1] & { restrictions: RestrictionPolicy }) {
  validateApplicationSelection(input)
  return executeApplications({ ...input, positions: structuredClone(input.positions), collection: { runId: input.collection.collection.runId, digest: input.collection.digest, stackId: input.stackId, ...(input.candidate.databaseClientId ? { studentId: input.candidate.databaseClientId } : {}) } }, {
    ...deps,
    eligibility: async (candidate, position) => {
      const student = studentEligibilityContext(candidate)
      const seniority = higherSeniorityGate(position.title, student.seniorityExceptions)
      if (seniority.decision === 'excluded') return { fit: seniority, restrictionChecks: [] }
      const result = await evaluateRestrictions(student, position, await deps.restrictions.load(student), deps.restrictions.evaluate)
      return { fit: { decision: result.decision, reasons: result.reasons.length ? result.reasons : ['Stack matches; no applicable restriction'], evidence: result.evidence }, restrictionChecks: result.checks }
    }
  })
}
export { createAtsAdapters } from './ats-forms.ts'
