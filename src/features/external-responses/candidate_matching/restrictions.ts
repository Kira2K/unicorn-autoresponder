import type { Position } from '../types.ts'
import { studentEligibilityContext } from './student-context.ts'
import type { EligibilityStudent } from './student-context.ts'

export type Restriction = { id: string; instruction: string; source: string; context?: Record<string, unknown> }
export type RestrictionSet = { studentId: string; checkedAt: string; complete: boolean; rules: Restriction[] }
export type RestrictionDecision = { decision: 'clear' | 'block' | 'review'; reason: string; evidence: string[] }
export type RestrictionCheck = RestrictionDecision & { ruleId: string; source: string }
export type RestrictionPolicy = {
  load(candidate: EligibilityStudent): Promise<RestrictionSet>
  evaluate?: (rule: Restriction, candidate: EligibilityStudent, position: Position) => Promise<RestrictionDecision>
}

/** A complete empty rule set allows. Read/evaluation failures never mean absence of restrictions. */
export async function evaluateRestrictions(candidate: EligibilityStudent, position: Position, set: RestrictionSet, evaluate?: RestrictionPolicy['evaluate']) {
  const student = studentEligibilityContext(candidate)
  const checks: RestrictionCheck[] = []
  if (!set.complete || set.studentId !== (candidate.databaseClientId ?? candidate.id) || !Number.isFinite(Date.parse(set.checkedAt))) throw Error('restriction_snapshot_incomplete')
  if (new Set(set.rules.map(r => r.id)).size !== set.rules.length) throw Error('duplicate_restriction_identity')
  for (const rule of set.rules) {
    let result: RestrictionDecision = { decision: 'review', reason: 'Restriction evaluation unavailable', evidence: [] }
    const companyIds = [position.source, ...(position.sources ?? [])].map(s => s.database?.companyId).filter(Boolean)
    if (rule.context?.applicationRoute === 'notify_only' && companyIds.length) {
      result = { decision: companyIds.includes(String(rule.context.companyId)) ? 'block' : 'clear', reason: 'Stored company routing', evidence: ['noco.companies.application_route; explicit company ID'] }
    } else if (evaluate && rule.instruction.trim()) {
      try { result = await evaluate(rule, student, position) } catch { /* preserve review */ }
    }
    if (!result || !['clear', 'block', 'review'].includes(result.decision) || !result.reason?.trim() || !Array.isArray(result.evidence) || result.decision !== 'review' && !result.evidence.some(e => typeof e === 'string' && e.trim())) {
      result = { decision: 'review', reason: 'Restriction decision lacks evidence', evidence: [] }
    }
    checks.push({ ...result, ruleId: rule.id, source: rule.source })
  }
  const decision: NonNullable<Position['fit']>['decision'] = checks.some(c => c.decision === 'block') ? 'excluded' : checks.some(c => c.decision === 'review') ? 'review' : 'eligible'
  return { decision, reasons: checks.filter(c => c.decision !== 'clear').map(c => c.reason), evidence: [`Restrictions checked at ${set.checkedAt}`, ...checks.flatMap(c => c.evidence)], checks }
}
