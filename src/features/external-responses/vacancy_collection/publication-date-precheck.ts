import { digest } from '../../company-client-management/legacy-snapshot.mts'
import type { Position } from '../types.ts'
import type { SelectionRules } from '../stack_classification/rules.ts'
import { publicationContext } from './posting-content.ts'

export type PublicationDateConfig = {
  version: 1
  maxAgeUtcDays: number
  rules: {
    expired: { id: string; reason: string }
    inspectionRequired: { id: string; reason: string }
  }
}
export type PublicationDateDecision =
  | { decision: 'continue'; status: 'missing' | 'eligible'; context: ReturnType<typeof publicationContext> }
  | { decision: 'excluded' | 'inspect'; status: 'expired' | 'invalid' | 'future' | 'contradictory' | 'ambiguous'; ruleId: string; reason: string; context: ReturnType<typeof publicationContext> }
export type PublicationDateAudit = {
  title: string; url: string; decision: 'excluded' | 'inspect'; status: PublicationDateDecision['status']
  ruleId: string; reason: string; policyHash: string; asOfDate: string; evidence: string[]
  publicationDate?: string; ageDays?: number
}

export function publicationDateConfig(rules: SelectionRules): PublicationDateConfig {
  const match = /```publication-date-precheck-json\s*\n([\s\S]*?)\n```/.exec(rules.text)
  if (!match) throw Error('publication_date_precheck_configuration_required')
  let value: unknown
  try { value = JSON.parse(match[1]) } catch { throw Error('publication_date_precheck_configuration_invalid') }
  const config = value as PublicationDateConfig
  if (config?.version !== 1 || !Number.isSafeInteger(config.maxAgeUtcDays) || config.maxAgeUtcDays < 0) throw Error('publication_date_precheck_configuration_invalid')
  for (const rule of [config.rules?.expired, config.rules?.inspectionRequired]) {
    if (!rule || typeof rule.id !== 'string' || !rule.id.trim() || typeof rule.reason !== 'string' || !rule.reason.trim()) throw Error('publication_date_precheck_configuration_invalid')
  }
  return config
}

export function evaluatePublicationDate(position: Pick<Position, 'description' | 'publicationLabels' | 'publicationDates' | 'publishedAt' | 'retrievedAt'>, rules: SelectionRules, now = new Date()): PublicationDateDecision {
  const context = publicationContext(position, now)
  if (context.status === 'missing') return { decision: 'continue', status: 'missing', context }
  const config = publicationDateConfig(rules)
  if (context.status === 'valid') {
    if (context.ageDays! <= config.maxAgeUtcDays) return { decision: 'continue', status: 'eligible', context }
    return { decision: 'excluded', status: 'expired', ruleId: config.rules.expired.id, reason: config.rules.expired.reason, context }
  }
  return { decision: 'inspect', status: context.status, ruleId: config.rules.inspectionRequired.id, reason: config.rules.inspectionRequired.reason, context }
}

export function publicationDateAudit(position: Pick<Position, 'title' | 'url' | 'description' | 'publicationLabels' | 'publicationDates' | 'publishedAt' | 'retrievedAt'>, decision: Extract<PublicationDateDecision, {decision:'excluded'|'inspect'}>, policyHash: string): PublicationDateAudit {
  return { title: position.title, url: position.url, decision: decision.decision, status: decision.status, ruleId: decision.ruleId,
    reason: decision.reason, policyHash, asOfDate: decision.context.asOfDate, evidence: decision.context.evidence,
    ...(decision.context.publicationDate ? { publicationDate: decision.context.publicationDate } : {}),
    ...(decision.context.ageDays !== undefined ? { ageDays: decision.context.ageDays } : {}) }
}

export const publicationDatePolicyHash = (rules: SelectionRules) => digest(publicationDateConfig(rules))
