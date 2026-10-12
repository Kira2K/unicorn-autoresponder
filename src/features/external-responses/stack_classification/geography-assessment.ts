import type { Position } from '../types.ts'
import type { StackDecision } from './index.ts'
import type { SelectionRules } from './rules.ts'
import { createGeographyPrecheck } from './geography-precheck.ts'

/** A semantic resolution must cite the unresolved geography, never bypass a definite exclusion. */
export function assertGeographyAssessment(position: Position, decision: StackDecision, rules: SelectionRules) {
  if (decision.decision !== 'eligible') return
  const geography = createGeographyPrecheck(rules)?.(position)
  if (!geography || geography.status === 'allowed') return
  if (geography.status === 'excluded' || !geography.evidence.length ||
    geography.evidence.some(text => !decision.evidence.some(quote => quote.includes(text) &&
      [position.location, position.description].some(source => source.includes(quote))))) {
    throw Error('geography_evidence_required')
  }
}
