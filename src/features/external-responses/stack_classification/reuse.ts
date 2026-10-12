import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { EXTRACTOR_VERSION } from '../vacancy_collection/source-memory.ts'
import { classifyVacancies, assertClassificationIntegrity } from './index.ts'
import type { StackDecision, ClassifiedCollection, AssessmentProvenance } from './index.ts'
import type { Position } from '../types.ts'
import type { StackProfile } from '../stack_catalog/index.ts'
import type { SelectionRules } from './rules.ts'
import { decisionRulesHash } from './rules.ts'
import type { VacancyCollection } from '../vacancy_collection/index.ts'
import { postingContent, publicationContext } from '../vacancy_collection/posting-content.ts'
import { descriptionIssue } from '../vacancy_collection/description-quality.ts'
import { createAssessmentPrecheck } from './precheck.ts'
import type { ExchangeRates } from './salary.ts'
import { createTitleStackSelector } from '../vacancy_collection/title-precheck.ts'
import { assertGeographyAssessment } from './geography-assessment.ts'
import { recordedSalaryContext } from './salary-precheck.ts'

export type Assessment = { global: StackDecision; stacks: Record<string, StackDecision> }
export type CachedAssessment = { cacheVersion?:'semantic-v1'; key: string; policy: string; semanticAssessment?: Assessment; assessment?:Assessment; origin: 'api' | 'human' | 'assistant_session'; observedRun: string; reviewedAt: string }
export type Evaluation = { pendingIds: string[]; hits: number; calls: number; sessionReviews?:number; records: Record<string, { origin: string; reused: boolean; fromRun?: string; reason?: string; reviewedAt?:string }> }
export function decisionKey(position: Position, stacks: StackProfile[], rules: SelectionRules, policy: string, now = new Date(), exchangeRates?:ExchangeRates) {
  void now
  return digest({ version: 7, cache: 'semantic-v1', extractor: EXTRACTOR_VERSION, policy, rules: decisionRulesHash(rules), exchangeRates:recordedSalaryContext(position,rules,exchangeRates)?.exchangeRates,
    stacks: stacks.map(({ id, name, description, seniorities, technologyGroups, roleTerms, excludedTitleTerms }) => ({ id, name, description, seniorities, technologyGroups, roleTerms, excludedTitleTerms })).sort((a,b) => a.id.localeCompare(b.id)),
    vacancy: { company: position.company, title: position.title, description: postingContent(position.description).description, location: position.location, url: position.url, applyUrl: position.applyUrl, sourceUrl: position.source.url, companyId: position.source.database?.companyId, engine:position.extraction?.engine, market: position.market?{value:position.market.value,language:position.market.language}:undefined, compensation: position.compensation, destinations: position.applicationDestinations ?? [] } })
}
export function validateAssessment(value: Assessment, position: Position, stacks: StackProfile[], rules?:SelectionRules) {
  if(rules)assertGeographyAssessment(position,value.global,rules)
  if (value.global.decision==='eligible' && descriptionIssue(position.description)) throw Error('assessment_description_not_substantive')
  const check = (decision: StackDecision) => {
    if (!decision || !['eligible','excluded','review'].includes(decision.decision) || !decision.reasons?.some(s => typeof s === 'string' && s.trim()) || !decision.evidence?.length || decision.evidence.some(s => typeof s !== 'string' || !s.trim() || ![position.title, position.description, position.location, ...publicationContext(position).evidence].some(text => text?.includes(s)))) throw Error('assessment_evidence_invalid')
  }
  check(value.global)
  if (value.global.decision === 'eligible') for (const stack of stacks) check(value.stacks[stack.id])
}
export function semanticCacheHit(position:Position,stacks:StackProfile[],rules:SelectionRules,policy:string,caches:(CachedAssessment|undefined)[],exchangeRates?:ExchangeRates) {
  const key=decisionKey(position,stacks,rules,policy,new Date(),exchangeRates)
  for(const cached of caches)if(cached?.cacheVersion==='semantic-v1'&&cached.key===key&&cached.policy===policy&&cached.semanticAssessment) {
    try {validateAssessment(cached.semanticAssessment,position,stacks,rules);return cached}catch{/* exact but invalid evidence is a miss */}
  }
  return undefined
}
export function seedReviewedCache(saved: ClassifiedCollection, rules: SelectionRules, stacks: StackProfile[]) {
  assertClassificationIntegrity(saved)
  const entries: Record<string, CachedAssessment> = {}
  // Explicit seeding still requires an exact historical snapshot; no automatic rekey of legacy entries.
  if (!saved.assessmentProvenance || saved.assessmentCacheVersion!=='semantic-v1' || saved.selectionRules?.sha256 !== rules.sha256) return entries
  if (digest(saved.stacks.map(s=>({id:s.id,name:s.name,description:s.description})).sort((a,b)=>a.id.localeCompare(b.id))) !== digest(stacks.map(s=>({id:s.id,name:s.name,description:s.description})).sort((a,b)=>a.id.localeCompare(b.id)))) return entries
  for (const position of saved.collection.positions) {
    const assessment = saved.semanticAssessments?.[position.id]
    if(!assessment)continue
    if(!assessment.global.evidence.length)continue
    validateAssessment(assessment, position, stacks, rules)
    entries[position.id] = { cacheVersion:'semantic-v1',key: decisionKey(position, stacks, rules, 'reviewed-v1',new Date(),saved.exchangeRates), policy: 'reviewed-v1', semanticAssessment:assessment, origin: saved.assessmentProvenance.origin, reviewedAt: saved.assessmentProvenance.reviewedAt, observedRun: saved.collection.runId }
  }
  return entries
}
/** One semantic call per uncached vacancy. Pending/failed calls never enter the cache. */
export async function classifyWithReuse(input: { collection: VacancyCollection; rules: SelectionRules; cache: Record<string, CachedAssessment>; fallbackCache?:Record<string,CachedAssessment>; policy: string; assessmentProvenance?:AssessmentProvenance; exchangeRates?:ExchangeRates }, deps: { assess?: (position: Position, stacks: StackProfile[], rules: SelectionRules) => Promise<Assessment>; onDecision?: (id: string, outcome: string) => Promise<void>; now?: () => Date; pendingReasons?:Record<string,string> } = {}) {
  const stacks = input.collection.scope?.stacks ?? [], decisions = new Map<string, Assessment>(), updates: Record<string,CachedAssessment> = {}
  const evaluation: Evaluation = { pendingIds: [], hits: 0, calls: 0, records: {} }
  const selectStacks=createTitleStackSelector(input.rules,stacks)
  for (const position of input.collection.positions) {
    const assessedAt = deps.now?.() ?? new Date()
    const key = decisionKey(position, stacks, input.rules, input.policy, assessedAt, input.exchangeRates)
    let value: Assessment | undefined
    const automatic=createAssessmentPrecheck(input.rules,input.collection.scope,assessedAt,input.exchangeRates)(position)
    if(automatic) {
      value={global:automatic,stacks:{}}
      evaluation.records[position.id]={origin:'deterministic_precheck',reused:false,reason:automatic.reasons.join('; ')}
      if(automatic.decision==='review')evaluation.pendingIds.push(position.id)
    }
    const cached=!value?semanticCacheHit(position,stacks,input.rules,input.policy,[input.cache[position.id],input.fallbackCache?.[position.id]],input.exchangeRates):undefined
    if(cached) {value=structuredClone(cached.semanticAssessment!);evaluation.hits++;evaluation.records[position.id]={origin:cached.origin,reused:true,fromRun:cached.observedRun,reviewedAt:cached.reviewedAt};updates[position.id]=cached}
    if (!value && deps.assess && !deps.pendingReasons?.[position.id] && position.description.trim() && (!descriptionIssue(position.description)||input.assessmentProvenance)) {
      try {
        const origin=input.assessmentProvenance?.origin??'api'
        if(origin==='api')evaluation.calls++;else evaluation.sessionReviews=(evaluation.sessionReviews??0)+1
        const candidates=selectStacks(position.title),candidateIds=new Set(candidates.map(s=>s.id))
        const assessed=await deps.assess(position, candidates, input.rules)
        value={global:assessed.global,stacks:Object.fromEntries(stacks.map(stack=>[stack.id,candidateIds.has(stack.id)?assessed.stacks[stack.id]:{decision:'excluded' as const,reasons:['Title does not route to this selected stack'],evidence:[position.title]}]))}
        validateAssessment(value, position, stacks, input.rules)
        updates[position.id] = { cacheVersion:'semantic-v1',key, policy: input.policy, semanticAssessment:value, origin, observedRun: input.collection.runId, reviewedAt: input.assessmentProvenance?.reviewedAt??assessedAt.toISOString() }
        evaluation.records[position.id] = { origin, reused: false, reviewedAt:updates[position.id].reviewedAt }
      } catch { value = undefined; evaluation.records[position.id] = { origin: 'pending', reused: false, reason: 'assessment_failed_or_invalid' } }
    }
    if (!value) {
      if(!evaluation.pendingIds.includes(position.id))evaluation.pendingIds.push(position.id)
      const pending: StackDecision = { decision: 'review', reasons: ['Classification pending: configured approved assessor and/or complete evidence required'], evidence: [] }
      value = { global: pending, stacks: {} }
      evaluation.records[position.id] ??= { origin: 'pending', reused: false, reason: deps.pendingReasons?.[position.id]??'assessor_not_configured_or_approved' }
    }
    decisions.set(position.id, value)
    await deps.onDecision?.(position.id, evaluation.records[position.id].reused ? 'cache_hit' : evaluation.records[position.id].origin)
  }
  const classified = await classifyVacancies({ collection: input.collection, selectionRules: input.rules, evaluation,assessmentProvenance:input.assessmentProvenance,assessmentCacheVersion:'semantic-v1',now:deps.now?.(),exchangeRates:input.exchangeRates }, {
    assessGlobal: async p => decisions.get(p.id)!.global, assess: async (p,s) => decisions.get(p.id)!.stacks[s.id],
  })
  for(const position of input.collection.positions)if(updates[position.id]&&!updates[position.id].semanticAssessment?.global.evidence.length)delete updates[position.id]
  return { classified, updates }
}
