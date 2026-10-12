import { assertCollectionReady } from '../stack_classification/index.ts'
import type { ClassifiedCollection } from '../stack_classification/index.ts'
import type { Candidate, Position } from '../types.ts'
import { studentEligibilityContext } from './student-context.ts'
import type { EligibilityStudent } from './student-context.ts'
import { assertCampaignStudent } from '../stack_catalog/campaign.ts'
import { evaluateRestrictions } from './restrictions.ts'
import type { RestrictionPolicy, RestrictionSet } from './restrictions.ts'
import { isDuplicate } from '../infrastructure/identity.ts'
import { higherSeniorityGate } from './seniority.ts'
/** Student eligibility = stack match + no applicable restriction. No extra CV-fit scoring. */
export async function matchCandidatePositions(input: { candidate: EligibilityStudent & Pick<Candidate, 'stackIds' | 'history'>; collection: ClassifiedCollection; stackId: string }, deps: { restrictions: RestrictionPolicy }) {
  const student = studentEligibilityContext(input.candidate)
  assertCollectionReady(input.collection, input.collection.groups[input.stackId]?.matchedIds ?? [])
  if (input.collection.collection.scope) assertCampaignStudent(input.collection.collection.scope, input.stackId, input.candidate.databaseClientId)
  else if (!input.candidate.stackIds?.includes(input.stackId)) throw Error('candidate_stack_mismatch')
  const group = input.collection.groups[input.stackId]; if (!group) throw Error('stack_not_collected')
  const positions: Position[] = []
  let rules: RestrictionSet | undefined
  try { rules = await deps.restrictions.load(student) } catch { /* surface as review, never empty */ }
  for (const raw of input.collection.collection.positions.filter(position => group.matchedIds.includes(position.id))) {
    const position = structuredClone(raw)
    const seniority = higherSeniorityGate(position.title, student.seniorityExceptions)
    if ([position.source, ...(position.sources ?? [])].some(s => s.database?.applicationRoute === 'notify_only')) {
      position.fit = { decision: 'excluded', reasons: ['Company is report-only; no automatic application'], evidence: [position.source.url] }
    } else if (seniority.decision === 'excluded') {
      position.fit = seniority
    } else if (isDuplicate(position, input.candidate.history)) {
      position.fit = { decision: 'excluded', reasons: ['Existing application or skip history'], evidence: [position.url] }
    } else {
      try {
        if (!rules) throw Error('restrictions_unavailable')
        const result = await evaluateRestrictions(student, position, rules, deps.restrictions.evaluate)
        position.restrictionChecks = result.checks
        position.fit = { decision: result.decision, reasons: result.reasons.length ? result.reasons : ['Stack matches; no applicable restriction'], evidence: result.evidence }
      } catch {
        position.fit = { decision: 'review', reasons: ['Complete restriction check unavailable'], evidence: [] }
      }
    }
    positions.push(position)
  }
  return { candidateId: input.candidate.id, stackId: input.stackId, collectionDigest: input.collection.digest, positions }
}
