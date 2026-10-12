import { createHash } from 'node:crypto'
import { validateStackProfiles } from '../stack_catalog/index.ts'
import type { StackProfile } from '../stack_catalog/index.ts'
import { collectionIssues } from '../vacancy_collection/index.ts'
import type { VacancyCollection } from '../vacancy_collection/index.ts'
import type { Position } from '../types.ts'
import { assertCampaignScope } from '../stack_catalog/campaign.ts'
import { assertSelectionRules } from './rules.ts'
import type { SelectionRules } from './rules.ts'
import { createAssessmentPrecheck } from './precheck.ts'
import { assertGeographyAssessment } from './geography-assessment.ts'
import type { ExchangeRates } from './salary.ts'
import { createTitleStackSelector } from '../vacancy_collection/title-precheck.ts'
export type StackDecision = { decision: 'eligible' | 'review' | 'excluded'; reasons: string[]; evidence: string[] }
export type AssessmentProvenance = { origin: 'assistant_session' | 'human'; reviewedBy: string; reviewedAt: string; reviewHash: string }
export type ClassifiedCollection = { version: 1; collection: VacancyCollection; stacks: StackProfile[]; groups: Record<string, { matchedIds: string[]; reviewIds: string[]; excludedIds: string[] }>; decisions: Record<string, Record<string, StackDecision>>; selectionRules?: SelectionRules; globalDecisions?: Record<string, StackDecision>; semanticAssessments?:Record<string,{global:StackDecision;stacks:Record<string,StackDecision>}>; assessmentProvenance?: AssessmentProvenance; assessmentCacheVersion?:'semantic-v1'; exchangeRates?:ExchangeRates; evaluation?: import('./reuse.ts').Evaluation; configurationIssues: string[]; readyForApplications: boolean; digest: string }
function validDecision(value: StackDecision) {
  return value && ['eligible', 'review', 'excluded'].includes(value.decision) && Array.isArray(value.reasons) && value.reasons.some(s => typeof s === 'string' && s.trim()) && Array.isArray(value.evidence) && (value.decision === 'review' || value.evidence.some(s => typeof s === 'string' && s.trim()))
}
function term(text: string, value: string) { const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').exec(text) }
function assess(position: Position, stack: StackProfile): StackDecision {
  const result = (decision: StackDecision['decision'], reason: string, evidence: string[] = []): StackDecision => ({ decision, reasons: [reason], evidence })
  if (stack.description?.trim()) return result('review', 'Database stack description requires a semantic assessor')
  if (stack.excludedTitleTerms?.some(value => term(position.title, value))) return result('excluded', 'Excluded role type', [position.title])
  const levels = ['intern', 'graduate', 'junior', 'head', 'manager', 'principal', 'staff', 'lead', 'senior'].filter(level => term(position.title, level))
  if (/\b(middle|mid[- ]?level|intermediate)\b/i.test(position.title)) levels.push('middle')
  if (levels.length > 1) return result('review', 'Multiple seniority levels need review', [position.title])
  const level = levels[0]
  if (!level) return result('review', 'Seniority needs evidence')
  if (!stack.seniorities!.includes(level)) return result('excluded', 'Outside configured seniority', [position.title])
  if (!position.description.trim()) return result('review', 'Description unavailable')
  const text = position.title + '\n' + position.description, evidence: string[] = [position.title]
  if (!stack.roleTerms!.some(value => term(text, value))) return result('review', 'Role responsibilities need review')
  for (const group of stack.technologyGroups!) {
    const matches = group.map(value => term(text, value)).filter(match => !!match)
    if (!matches.length) return result('review', 'Required technology not established: ' + group.join(' / '))
    const positive = matches.find(match => {
      const excerpt = text.slice(Math.max(0, match.index - 75), match.index + match[0].length + 100)
      return !/\b(optional|bonus|nice.to.have|not required|no experience|without|migrat\w* away from)\b/i.test(excerpt)
    })
    if (!positive) return result('review', 'Technology mention is optional, negated or ambiguous: ' + group.join(' / '))
    evidence.push(text.slice(Math.max(0, positive.index - 60), positive.index + positive[0].length + 80))
  }
  return result('eligible', 'Role, seniority and required technologies match the stack policy', evidence)
}
const fingerprint = (value: Omit<ClassifiedCollection, 'digest'>) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export async function classifyVacancies(input: { collection: VacancyCollection; stacks?: StackProfile[]; selectionRules?: SelectionRules; assessmentProvenance?: AssessmentProvenance; assessmentCacheVersion?:'semantic-v1'; evaluation?: import('./reuse.ts').Evaluation; now?:Date; exchangeRates?:ExchangeRates }, deps: { assess?: (position: Position, stack: StackProfile) => Promise<StackDecision>; assessGlobal?: (position: Position, rules: SelectionRules) => Promise<StackDecision> } = {}): Promise<ClassifiedCollection> {
  const collection = structuredClone(input.collection)
  const selectionRules = input.selectionRules ? structuredClone(input.selectionRules) : undefined
  if (selectionRules) assertSelectionRules(selectionRules)
  if (collection.scope) {
    assertCampaignScope(collection.scope)
    if (input.stacks && JSON.stringify(input.stacks) !== JSON.stringify(collection.scope.stacks)) throw Error('campaign_stack_override_forbidden')
  }
  const stacks = structuredClone(collection.scope?.stacks ?? input.stacks ?? []), configurationIssues = validateStackProfiles(stacks)
  const groups: ClassifiedCollection['groups'] = {}, decisions: ClassifiedCollection['decisions'] = {}
  const globalDecisions: Record<string, StackDecision> = {}
  const semanticAssessments:NonNullable<ClassifiedCollection['semanticAssessments']>={}
  const precheck = selectionRules ? createAssessmentPrecheck(selectionRules, collection.scope, input.now, input.exchangeRates) : undefined
  const selectStacks=selectionRules&&collection.scope?createTitleStackSelector(selectionRules,stacks):()=>stacks
  const titleRoutes=new Map(collection.positions.map(p=>[p.id,new Set(selectStacks(p.title).map(s=>s.id))]))
  if (selectionRules && !configurationIssues.length) for (const position of collection.positions) {
    let decision: StackDecision = { decision: 'review', reasons: ['Global vacancy rules require assessment'], evidence: [] }
    try {
      const automatic = precheck?.(position)
      if (automatic) decision = automatic
      else if (deps.assessGlobal) {decision = await deps.assessGlobal(position, selectionRules);semanticAssessments[position.id]={global:structuredClone(decision),stacks:{}}}
      assertGeographyAssessment(position,decision,selectionRules)
    } catch { decision = { decision: 'review', reasons: ['Global vacancy assessment unavailable'], evidence: [] } }
    if (!validDecision(decision)) decision = { decision: 'review', reasons: ['Global vacancy decision lacks evidence'], evidence: [] }
    globalDecisions[position.id] = decision
  }
  if (!configurationIssues.length) for (const stack of stacks) {
    const group = { matchedIds: [] as string[], reviewIds: [] as string[], excludedIds: [] as string[] }; groups[stack.id] = group; decisions[stack.id] = {}
    for (const position of collection.positions) {
      let decision: StackDecision
      try { decision = !titleRoutes.get(position.id)!.has(stack.id)
        ? {decision:'excluded',reasons:['Title does not route to this selected stack'],evidence:[position.title]}
        : selectionRules && globalDecisions[position.id].decision !== 'eligible'
        ? { ...globalDecisions[position.id], reasons: globalDecisions[position.id].reasons.map(reason => 'Global rules: ' + reason) }
        : !position.description.trim()
        ? { decision: 'review', reasons: ['Description unavailable'], evidence: [] }
        : deps.assess ? await deps.assess(position, stack) : assess(position, stack)
      } catch { decision = { decision: 'review', reasons: ['Stack assessment unavailable'], evidence: [] } }
      if (!validDecision(decision)) decision = { decision: 'review', reasons: ['Stack evidence missing'], evidence: [] }
      decisions[stack.id][position.id] = decision
      if(semanticAssessments[position.id]&&globalDecisions[position.id].decision==='eligible')semanticAssessments[position.id].stacks[stack.id]=structuredClone(decision)
      group[decision.decision === 'eligible' ? 'matchedIds' : decision.decision === 'review' ? 'reviewIds' : 'excludedIds'].push(position.id)
    }
  }
  for(const [id,value] of Object.entries(semanticAssessments))if(value.global.decision==='eligible'&&stacks.some(stack=>!value.stacks[stack.id]))delete semanticAssessments[id]
  const value = { version: 1 as const, collection, stacks, groups, decisions, ...(selectionRules ? { selectionRules, globalDecisions } : {}), ...(Object.keys(semanticAssessments).length?{semanticAssessments}:{}), ...(input.assessmentProvenance ? { assessmentProvenance: structuredClone(input.assessmentProvenance) } : {}),...(input.assessmentCacheVersion?{assessmentCacheVersion:input.assessmentCacheVersion}:{}), ...(input.exchangeRates?{exchangeRates:structuredClone(input.exchangeRates)}:{}), ...(input.evaluation ? { evaluation: structuredClone(input.evaluation) } : {}), configurationIssues, readyForApplications: !configurationIssues.length && !collectionIssues(collection).length && !input.evaluation?.pendingIds.length }
  return { ...value, digest: fingerprint(value) }
}
/** Classification validity is independent of full-source application readiness. */
export function assertClassificationIntegrity(value: ClassifiedCollection) {
  if (!value) throw Error('collection_required')
  if (value.collection.scope) {
    assertCampaignScope(value.collection.scope)
    if (JSON.stringify(value.stacks) !== JSON.stringify(value.collection.scope.stacks)) throw Error('campaign_stack_override_forbidden')
  }
  if (validateStackProfiles(value.stacks).length || value.configurationIssues.length) throw Error('stack_configuration_required')
  const { digest, ...content } = value
  if (fingerprint(content) !== digest) throw Error('collection_changed: reclassify the complete collection')
  const ids = value.collection.positions.map(position => position.id)
  const selectStacks=value.selectionRules&&value.collection.scope?createTitleStackSelector(value.selectionRules,value.stacks):()=>value.stacks
  const titleRoutes=new Map(value.collection.positions.map(p=>[p.id,new Set(selectStacks(p.title).map(s=>s.id))]))
  if (new Set(ids).size !== ids.length) throw Error('stack_classification_duplicate_vacancy')
  if (value.globalDecisions && !value.selectionRules) throw Error('global_selection_rules_required')
  if (value.selectionRules) {
    assertSelectionRules(value.selectionRules)
    if (!value.globalDecisions || Object.keys(value.globalDecisions).length !== ids.length || ids.some(id => !validDecision(value.globalDecisions![id]))) throw Error('global_selection_incomplete')
    for(const position of value.collection.positions)assertGeographyAssessment(position,value.globalDecisions[position.id],value.selectionRules)
  }
  for (const stack of value.stacks) {
    const group = value.groups[stack.id]
    const classified = group ? [...group.matchedIds, ...group.reviewIds, ...group.excludedIds] : []
    if (!group || classified.length !== ids.length || new Set(classified).size !== ids.length || classified.some(id => !ids.includes(id))) throw Error('stack_classification_incomplete')
    for (const [key, expected] of [['matchedIds', 'eligible'], ['reviewIds', 'review'], ['excludedIds', 'excluded']] as const) {
      for (const id of group[key]) {
        const decision = value.decisions[stack.id]?.[id]
        if (decision?.decision !== expected || !Array.isArray(decision.reasons) || !Array.isArray(decision.evidence)) throw Error('stack_classification_inconsistent')
        if (value.selectionRules && value.globalDecisions![id].decision !== 'eligible' && expected !== value.globalDecisions![id].decision && !(expected==='excluded'&&!titleRoutes.get(id)!.has(stack.id))) throw Error('global_selection_bypassed')
        if(expected!=='excluded'&&!titleRoutes.get(id)!.has(stack.id))throw Error('title_stack_routing_bypassed')
        if (expected === 'eligible' && !decision.evidence.some(text => typeof text === 'string' && text.trim())) throw Error('stack_classification_evidence_required')
      }
    }
  }
}
export function assertCollectionReady(value: ClassifiedCollection, targetIds?: string[]) {
  if (!value) throw Error('collection_required')
  if (collectionIssues(value.collection).length) throw Error('collection_incomplete: every source must have a recorded terminal outcome before applications')
  assertClassificationIntegrity(value)
  if (targetIds !== undefined) {
    if (value.configurationIssues.length) throw Error('stack_configuration_required')
    const accepted = new Set(Object.values(value.groups).flatMap(group => group.matchedIds))
    if (targetIds.some(id => !accepted.has(id) || value.evaluation?.pendingIds.includes(id))) throw Error('application_target_assessment_required')
    return
  }
  if (!value.readyForApplications) throw Error('collection_changed: reclassify the complete collection')
}
