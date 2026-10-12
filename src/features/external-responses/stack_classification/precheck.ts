import type { SelectionRules } from './rules.ts'
import type { StackDecision } from './index.ts'
import type { CampaignScope } from '../stack_catalog/campaign.ts'
import type { Position } from '../types.ts'
import { createTitlePrecheck } from '../vacancy_collection/title-precheck.ts'
import { evaluatePublicationDate, publicationDateConfig } from '../vacancy_collection/publication-date-precheck.ts'
import { descriptionIssue } from '../vacancy_collection/description-quality.ts'
import { checkSalary, salaryFloor } from './salary-precheck.ts'
import type { ExchangeRates } from './salary.ts'
import { createGeographyPrecheck } from './geography-precheck.ts'

/** Shared cheap gate for classification and review packets. Undefined means semantic assessment is needed. */
export function createAssessmentPrecheck(rules: SelectionRules, scope?: CampaignScope, now?: Date, rates?: ExchangeRates) {
  const title = scope && rules.text.includes('```title-precheck-json') ? createTitlePrecheck(rules, scope) : undefined
  const floor = salaryFloor(rules)
  const geography=createGeographyPrecheck(rules)
  let publication = false
  try { publicationDateConfig(rules); publication = true } catch (error) {
    if ((error as Error).message !== 'publication_date_precheck_configuration_required') throw error
  }
  return (position: Position): StackDecision | undefined => {
    const decision = title?.evaluate(position.title)
    if (decision?.decision === 'excluded') return { decision: 'excluded', reasons: [decision.reason], evidence: [position.title] }
    const date = publication ? evaluatePublicationDate(position, rules, now) : undefined
    if (date?.decision === 'excluded' || date?.decision === 'inspect') return { decision: date.decision === 'excluded' ? 'excluded' : 'review', reasons: [date.reason], evidence: date.context.evidence }
    const salary = floor === undefined ? undefined : checkSalary(position, floor, rates)
    if (salary?.status === 'excluded' || salary?.status === 'review') return { decision: salary.status, reasons: [salary.reason], evidence: salary.evidence }
    const location=geography?.(position)
    if(location?.status==='excluded')return {decision:'excluded',reasons:[location.reason],evidence:location.evidence}
    // Unresolved wording with a complete description goes to the semantic assessor.
    // Missing evidence, invalid dates and unavailable salary arithmetic remain data review.
    const issue = descriptionIssue(position.description)
    if (!position.description.trim() || issue) return { decision: 'review', reasons: ['Substantive description unavailable: ' + (issue ?? 'empty')], evidence: position.description.trim() ? [position.description.trim().slice(0, 180)] : [] }
  }
}
