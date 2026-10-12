import { collectVacancies } from './index.ts'
import type { VacancyCollection } from './index.ts'
import { executeReasonedSource } from './reasoned-source.ts'
import type { CollectionReasoner } from './session-reasoner.ts'
import { reusableSearch, individualPostingGate, deferredInvestigation } from './source-memory.ts'
import type { SourceMemory, SourceAction } from './source-memory.ts'
import type { Source, SourceAudit, Position, PageReader } from '../types.ts'
import type { CampaignScope } from '../stack_catalog/campaign.ts'
import { mergePublicationDateOutcomes, mergeTitlePrecheckSkips, titlePrecheckMetadata, titlePrecheckPositions } from './title-precheck.ts'
import type { TitlePrecheck } from './title-precheck.ts'

/** Bounded source orchestration only; dependencies own persistence, browser and classification. */
export async function scanCollection(input:{runId:string;sources:Source[];scope:CampaignScope;force:boolean;maxPages:number;maxSourceMs?:number;memories:Map<string,SourceMemory>;hints?:Map<string,string[]>;retryReviews?:boolean;concurrency?:number;previousAttempt?:VacancyCollection;engineRoot?:string;titlePrecheck?:TitlePrecheck},deps:{reader:PageReader;loadRun:(id:string)=>Promise<VacancyCollection>;action:(source:Source,action:SourceAction)=>Promise<void>;onAttempt?:(source:Source)=>Promise<void>;onProgress?:(result:{positions:Position[];audit:SourceAudit[]})=>Promise<void>;reasoner?:CollectionReasoner}) {
  const concurrency = input.concurrency ?? 3
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw Error('invalid_collection_concurrency')
  const positions:Position[]=[],audit:SourceAudit[]=[],runs=new Map<string,Promise<VacancyCollection>>()
  const sourceOrder=new Map(input.sources.map((s,i)=>[s.database!.sourceId,i]))
  const load=(id:string)=>{if(!runs.has(id))runs.set(id,deps.loadRun(id));return runs.get(id)!}
  let cursor=0,stopped=false
  let progress=Promise.resolve()
  const persistProgress=async()=>{const snapshot=structuredClone({positions,audit});progress=progress.then(()=>deps.onProgress?.(snapshot));await progress}
  const strategy={name:'repeatable-sources',discover:async()=>{
    const workers=await Promise.allSettled(Array.from({length:Math.min(concurrency,input.sources.length)},async()=>{
      try { while(!stopped && cursor<input.sources.length) {
        const source=input.sources[cursor++],id=source.database!.sourceId,memory=input.memories.get(id)!
        const compatibleAttempt=!input.titlePrecheck||input.previousAttempt?.titlePrecheck?.scopeHash===input.titlePrecheck.scopeHash
        const attemptAudit=compatibleAttempt?input.previousAttempt?.audit.find(a=>a.source.database?.sourceId===id):undefined
        const attemptPositions=compatibleAttempt?input.previousAttempt?.positions.filter(p=>(p.sources??[p.source]).some(s=>s.database?.sourceId===id))??[]:[]
        if(attemptAudit&&attemptAudit.terminal!==false&&!(attemptAudit.trace?.mode==='paused'&&individualPostingGate(source,memory.state.review?.gate))){positions.push(...attemptPositions);audit.push(attemptAudit);continue}
        let previousPositions:Position[]=[],snapshotPositions:Position[]=[],oldAudit:SourceAudit|undefined
        if(memory.state.snapshot) {
          const previous=await load(memory.state.snapshot.runId)
          snapshotPositions=previous.positions.filter(p=>(p.sources??[p.source]).some(s=>s.database?.sourceId===id))
          previousPositions=snapshotPositions.map(p=>({...p,source,sources:[source]}))
          if(input.titlePrecheck)previousPositions=titlePrecheckPositions(previousPositions,input.titlePrecheck).positions
          oldAudit=previous.audit.find(a=>a.source.database?.sourceId===id)
        }
        if(deferredInvestigation(source,memory,Date.now(),input.force,input.titlePrecheck?.scopeHash)&&oldAudit) {
          const at=new Date().toISOString(),action:SourceAction={operation:'retain_partial_pending_engine_repair',url:source.url,at,outcome:'reused',detail:memory.state.snapshot!.runId}
          await deps.action(source,action);positions.push(...previousPositions)
          const filtered=input.titlePrecheck?titlePrecheckPositions(snapshotPositions,input.titlePrecheck):undefined
          audit.push({...oldAudit,source,status:'partial',terminal:true,...(filtered?{titlePrecheck:titlePrecheckMetadata(input.titlePrecheck!,mergeTitlePrecheckSkips(input.titlePrecheck!,oldAudit.titlePrecheck,filtered.skipped)),...(input.titlePrecheck?.publication?{publicationDatePrecheck:mergePublicationDateOutcomes(oldAudit.publicationDatePrecheck,filtered.publicationOutcomes,input.titlePrecheck.publication.policyHash)}:{})}:{}),issues:[...oldAudit.issues,'Known engine gap is deferred; retained inspected findings are not complete coverage. Use --force-refresh to retry.'],trace:{mode:'paused',actions:[action],startedAt:at,finishedAt:at,requests:0,observedRun:memory.state.snapshot!.runId,recipeRevision:memory.recipe?.revision}})
        } else if(reusableSearch(source,memory,Date.now(),input.force,input.titlePrecheck?.scopeHash) && oldAudit?.status==='complete') {
          const at=new Date().toISOString(),action:SourceAction={operation:'reuse_complete_search',url:source.url,at,outcome:'reused',detail:memory.state.snapshot!.runId}
          await deps.action(source,action)
          positions.push(...previousPositions)
          const filtered=input.titlePrecheck?titlePrecheckPositions(snapshotPositions,input.titlePrecheck):undefined
          audit.push({...oldAudit,source,...(filtered?{found:filtered.positions.length,titlePrecheck:titlePrecheckMetadata(input.titlePrecheck!,mergeTitlePrecheckSkips(input.titlePrecheck!,oldAudit.titlePrecheck,filtered.skipped)),...(input.titlePrecheck?.publication?{publicationDatePrecheck:mergePublicationDateOutcomes(oldAudit.publicationDatePrecheck,filtered.publicationOutcomes,input.titlePrecheck.publication.policyHash)}:{})}:{}),trace:{mode:'reused',actions:[action],startedAt:at,finishedAt:at,requests:0,observedRun:memory.state.snapshot!.runId,recipeRevision:memory.recipe?.revision,recipe:memory.recipe??undefined}})
        } else {
          if(memory.state.review?.status!=='pending'||input.retryReviews||individualPostingGate(source,memory.state.review?.gate)) await deps.onAttempt?.(source)
          const result=await executeReasonedSource({runId:input.runId,source,memory,maxPages:input.maxPages,maxSourceMs:input.maxSourceMs,hintUrls:input.hints?.get(id),previousPositions,retryReview:input.retryReviews,titlePrecheck:input.titlePrecheck,engineRoot:input.engineRoot??'src/features/external-responses/vacancy_collection/engines',...(attemptAudit?.trace?.investigation?{previousAttempt:{positions:attemptPositions,audit:attemptAudit}}:{})},{reader:deps.reader,action:a=>deps.action(source,a),reasoner:deps.reasoner})
          positions.push(...result.positions);audit.push(result.audit)
        }
        await persistProgress()
      } } catch(error){stopped=true;throw error}
    }))
    const failure=workers.find(r=>r.status==='rejected')
    if(failure?.status==='rejected') { const error=failure.reason instanceof Error?failure.reason:new Error(String(failure.reason));Object.assign(error,{partial:{positions,audit}});throw error }
    // Worker completion order must not choose a different primary source for a shared posting.
    positions.sort((a,b)=>sourceOrder.get(a.source.database!.sourceId)!-sourceOrder.get(b.source.database!.sourceId)! || a.id.localeCompare(b.id))
    return {positions,audit}
  }}
  if(!input.sources.length)return {version:1 as const,runId:input.runId,sources:[],positions:[],audit:[],scope:input.scope,...(input.titlePrecheck?{titlePrecheck:titlePrecheckMetadata(input.titlePrecheck)}:{}),createdAt:new Date().toISOString()}
  const collection=await collectVacancies({runId:input.runId,sources:input.sources,scope:input.scope},{strategy})
  return {...collection,...(input.titlePrecheck?{titlePrecheck:titlePrecheckMetadata(input.titlePrecheck)}:{})}
}
