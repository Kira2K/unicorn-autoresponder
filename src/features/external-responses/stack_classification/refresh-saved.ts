import { createHash } from 'node:crypto'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import type { Position } from '../types.ts'
import type { StackProfile } from '../stack_catalog/index.ts'
import { assertCampaignScope } from '../stack_catalog/campaign.ts'
import type { CampaignScope } from '../stack_catalog/campaign.ts'
import { assertClassificationIntegrity } from './index.ts'
import type { ClassifiedCollection, AssessmentProvenance } from './index.ts'
import { assertSelectionRules } from './rules.ts'
import type { SelectionRules } from './rules.ts'
import { classifyWithReuse, decisionKey, seedReviewedCache, validateAssessment } from './reuse.ts'
import type { Assessment, CachedAssessment } from './reuse.ts'
import { withLatestPublicationEvidence, type PublicationEvidence } from '../vacancy_collection/publication-memory.ts'

export type RefreshSavedInput = {
  saved: ClassifiedCollection
  rules: SelectionRules
  stacks: StackProfile[]
  runId: string
  reviewed?: {
    assess: (position: Position, stacks: StackProfile[], rules: SelectionRules) => Promise<Assessment>
    provenance: AssessmentProvenance
  }
  now?: Date
  publicationEvidence?: PublicationEvidence[]
}

/** Every byte of prose matters; only the contents of supported machine-check blocks may change. */
function prose(value: SelectionRules) {
  return value.text.replace(/```(?:title|publication-date|salary|geography)-precheck-json\s*\n[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n').trim()
}
function sameStacks(before: StackProfile[], after: StackProfile[]) {
  const policy = (items: StackProfile[]) => items.map(item => {
    const { databaseId, studentIds, ...rules } = item as StackProfile & { studentIds?: string[] }
    return rules
  }).sort((a, b) => a.id.localeCompare(b.id))
  return digest(policy(before)) === digest(policy(after))
}
function refreshedScope(scope: CampaignScope, stacks: StackProfile[]): CampaignScope {
  const before = new Map(scope.stacks.map(stack => [stack.id, stack]))
  const next = stacks.map(stack => {
    const old = before.get(stack.id)
    const databaseId = (stack as CampaignScope['stacks'][number]).databaseId ?? old?.databaseId
    const studentIds = (stack as CampaignScope['stacks'][number]).studentIds ?? old?.studentIds
    if (!databaseId || !studentIds?.length) throw Error('refresh_stack_scope_missing')
    return { ...stack, databaseId, studentIds: [...studentIds] }
  })
  const content = { version: scope.version, database: scope.database, capturedAt: scope.capturedAt, stacks: next,
    excluded: structuredClone(scope.excluded), issues: structuredClone(scope.issues) }
  const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex')
  const refreshed = { ...content, digest }
  assertCampaignScope(refreshed)
  return refreshed
}

/** Refresh current rules against the saved public vacancy snapshot; this function performs no I/O. */
export async function refreshSavedClassification(input: RefreshSavedInput) {
  const { saved, rules, stacks } = input
  assertClassificationIntegrity(saved)
  assertSelectionRules(rules)
  if (!saved.selectionRules) throw Error('refresh_saved_rules_missing')
  assertSelectionRules(saved.selectionRules)
  if (!input.runId.trim() || input.runId === saved.collection.runId) throw Error('refresh_new_run_required')
  if (!saved.collection.scope) throw Error('refresh_campaign_scope_required')
  if (input.reviewed && (!['human', 'assistant_session'].includes(input.reviewed.provenance.origin) ||
    !input.reviewed.provenance.reviewedBy.trim() || !input.reviewed.provenance.reviewHash.trim() ||
    !Number.isFinite(Date.parse(input.reviewed.provenance.reviewedAt)))) throw Error('refresh_review_provenance_required')
  const collection = structuredClone(saved.collection)
  collection.positions = withLatestPublicationEvidence(collection.positions, input.publicationEvidence ?? [])
  collection.runId = input.runId
  collection.scope = refreshedScope(saved.collection.scope, structuredClone(stacks))
  const changedChecks = saved.selectionRules.sha256 !== rules.sha256 && prose(saved.selectionRules) === prose(rules)
  const compatible = prose(saved.selectionRules) === prose(rules) && sameStacks(saved.stacks, stacks) &&
    saved.assessmentCacheVersion === 'semantic-v1' && !!saved.assessmentProvenance
  const cache: Record<string, CachedAssessment> = {}
  if (compatible) {
    let seeded: Record<string, CachedAssessment> = {}
    if (saved.selectionRules.sha256 === rules.sha256) {
      try { seeded = seedReviewedCache(saved, saved.selectionRules, saved.stacks) }
      catch { /* Validate entries separately so one invalid review does not hide valid ones. */ }
    }
    for (const position of collection.positions) {
      const assessment = seeded?.[position.id]?.semanticAssessment ?? saved.semanticAssessments?.[position.id]
      if (!assessment) continue
      try {
        validateAssessment(assessment, position, stacks, rules)
        cache[position.id] = { cacheVersion: 'semantic-v1', key: decisionKey(position, stacks, rules, 'reviewed-v1', input.now, saved.exchangeRates),
          policy: 'reviewed-v1', semanticAssessment: structuredClone(assessment), origin: saved.assessmentProvenance!.origin,
          reviewedAt: saved.assessmentProvenance!.reviewedAt, observedRun: saved.collection.runId }
      } catch { /* Evidence or current metadata changed; leave this vacancy pending. */ }
    }
  }
  const result = await classifyWithReuse({ collection, rules, cache, policy: 'reviewed-v1', exchangeRates: saved.exchangeRates,
    assessmentProvenance: input.reviewed?.provenance ?? (compatible ? saved.assessmentProvenance : undefined) }, {
    ...(input.reviewed ? { assess: input.reviewed.assess } : {}),
    ...(input.now ? { now: () => input.now! } : {}),
  })
  return { ...result, summary: { newAiCalls: 0 as const, reused: result.classified.evaluation?.hits ?? 0,
    pending: result.classified.evaluation?.pendingIds.length ?? 0, changedChecks } }
}
