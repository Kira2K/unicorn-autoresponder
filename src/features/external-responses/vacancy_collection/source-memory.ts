import { digest } from '../../company-client-management/legacy-snapshot.mts'
import type { Source, SourceAudit, SourceAccessGate, PageDocument } from '../types.ts'
import type { CachedAssessment } from '../stack_classification/reuse.ts'

export const EXTRACTOR_VERSION = 'public-text-v15-explicit-employer-scope'
export type ControlStep = { operation: 'click' | 'clear_search' | 'fill_search'; role?: 'button' | 'link'; name?: string; selector?: string; value?: string }
export type ExtractionSelectors = {listingSelector?:string;detailLinkSelector?:string;titleSelector?:string;locationSelector?:string;descriptionSelector?:string;paginationSelector?:string;emptyStateSelector?:string}
export type EngineReference = {id:string;version:number;sha256:string;sourceId:string}
export type SourceAction = { operation: string; url: string; at: string; outcome: 'ok' | 'failed' | 'reused'; durationMs?: number; detail?: string; step?: ControlStep; evidenceRef?:string }
export type SourceRecipe = { version: 1; revision: string; verifiedAt: string; listingUrls: string[]; methods: string[]; controls: Record<string, ControlStep[]>; checks: { substantiveDescriptions: true; paginationComplete: true }; origin: 'observed'; extraction?:ExtractionSelectors; engine?:EngineReference; previous?:SourceRecipe; repairProvenance?:{requestId:string;model:string;origin:string} }
export type SourceTrace = { mode: 'fresh' | 'replay' | 'reused' | 'paused'; actions: SourceAction[]; startedAt: string; finishedAt: string; observedRun?: string; recipeRevision?: string; previousRecipe?: SourceRecipe; repaired?: boolean; repairOutcome?: 'succeeded' | 'failed' | 'not_attempted'; requests: number; recipe?: SourceRecipe; closed?: { url: string; at: string; evidence: string }[]; validator?:{url:string;http:NonNullable<PageDocument['httpValidator']>}; investigation?:{status:'pending'|'deferred'|'repaired'|'exhausted';request:import('./session-reasoner.ts').Investigation;attempts:number}; activeMs?:number }
export type SourceState = { version?: 1; snapshot?: { runId: string; configHash: string; status: SourceAudit['status']; searchedAt: string; recipeRevision?: string }; decisions?: Record<string, CachedAssessment>; review?: { status: 'pending' | 'resolved'; gate: SourceAccessGate }; health?: string; operatorAvailability?:{status:string;reason?:string;[key:string]:unknown}; investigation?:{status:string;runId:string;requestId:string;model:string;attempts?:number}; lastAttemptRun?: string; validator?:SourceTrace['validator'] }
export type SourceMemory = { recipe: SourceRecipe | null; state: SourceState; lastAttempt: string | null; lastComplete: string | null }
export const emptyMemory = (): SourceMemory => ({ recipe: null, state: {}, lastAttempt: null, lastComplete: null })
export const sourceUnavailable = (state:SourceState) => state.operatorAvailability?.status === 'unavailable' || state.health === 'unavailable'
/** Older audits sometimes paused a public board because one internal posting redirected to login. */
export function individualPostingGate(source:Source,gate?:SourceAccessGate) {
  if(gate?.kind!=='login_required')return false
  try {
    const barrier=new URL(gate.url),target=barrier.searchParams.get('redirect_to')
    if(!target)return false
    const posting=new URL(target),board=new URL(source.url)
    const detail=/\/(?:jobs?|vacanc(?:y|ies)|positions)\/[^/?]+/i
    return posting.hostname.replace(/^www\./,'')===board.hostname.replace(/^www\./,'')&&detail.test(posting.pathname)&&!detail.test(board.pathname)
  }catch{return false}
}
export const sourceConfigHash = (source: Source,titlePrecheckScopeHash?:string) => digest({ sourceId: source.database?.sourceId, companyId: source.database?.companyId, url: source.url, listingUrls: source.listingUrls ?? [], extractor: EXTRACTOR_VERSION,...(titlePrecheckScopeHash?{titlePrecheckScopeHash}:{}) })
export function reusableSearch(source: Source, memory: SourceMemory, now: number, force: boolean,titlePrecheckScopeHash?:string) {
  const saved = memory.state.snapshot, time = Date.parse(saved?.searchedAt ?? '')
  const compatible=saved?.configHash===sourceConfigHash(source,titlePrecheckScopeHash)||!!titlePrecheckScopeHash&&saved?.configHash===sourceConfigHash(source)
  return !force && !sourceUnavailable(memory.state) && memory.state.review?.status !== 'pending' && memory.state.investigation?.status !== 'pending' && saved?.status === 'complete' && compatible && saved.recipeRevision === memory.recipe?.revision && Number.isFinite(time) && now >= time && now - time < 7 * 86400000
}
/** Retain inspected partial findings while a known engine gap awaits repair; this is not complete freshness. */
export function deferredInvestigation(source:Source,memory:SourceMemory,now:number,force:boolean,titlePrecheckScopeHash?:string) {
  const saved=memory.state.snapshot,time=Date.parse(saved?.searchedAt??'')
  const compatible=saved?.configHash===sourceConfigHash(source,titlePrecheckScopeHash)||!!titlePrecheckScopeHash&&saved?.configHash===sourceConfigHash(source)
  return !force&&!sourceUnavailable(memory.state)&&['deferred','exhausted'].includes(memory.state.investigation?.status??'')&&saved?.status==='partial'&&compatible&&Number.isFinite(time)&&now>=time&&now-time<7*86400000
}
