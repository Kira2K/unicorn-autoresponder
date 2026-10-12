import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { executeSource } from './recipe.ts'
import { focusedInvestigation, validateRepairPlan } from './session-reasoner.ts'
import type { CollectionReasoner, RepairPlan } from './session-reasoner.ts'
import type { PageDocument, PageReader, Position, Source, SourceAudit } from '../types.ts'
import type { SourceAction, SourceMemory, SourceRecipe } from './source-memory.ts'
import { loadArtifact, validateForSource, evaluateEngine, runEngineFixtures, validateEngineCandidate } from './engines/index.ts'
import type { EngineArtifact, EngineFixture, EngineInput, EngineJob } from './engines/index.ts'
import { isLinkedInUrl } from '../infrastructure/navigation-policy.ts'
import type { TitlePrecheck } from './title-precheck.ts'

const limits={timeoutMs:1000,memoryLimitBytes:64*1024*1024}
type Result={positions:Position[];audit:SourceAudit}
const snapshot=(source:Source,page?:PageDocument):EngineInput=>({sourceId:source.database!.sourceId,url:page?.url??source.url,text:page?.text??'',links:(page?.links??[]).filter(l=>!isLinkedInUrl(l.url)),jobs:(page?.jobs??[]).filter(j=>j.description?.trim()&&!isLinkedInUrl(j.url)&&!isLinkedInUrl(j.applyUrl)).map(({title,location,description,url,applyUrl,publishedAt})=>({title,location,description,url,applyUrl,...(publishedAt?{publishedAt}:{})}))})
/** Guest parsing may select observed jobs, but cannot invent metadata or mix their fields. */
export function groundEngineJobs(page:PageDocument,jobs:EngineJob[]):EngineJob[] {
  const normalize=(value:string)=>value.replace(/\s+/g,' ').trim()
  const body=normalize(page.text),urls=new Set([page.url,...page.links.map(l=>l.url)])
  const observed=new Map(page.jobs.map(job=>[JSON.stringify([job.url,job.applyUrl]),job]))
  return jobs.map(job=>{
    const original=observed.get(JSON.stringify([job.url,job.applyUrl]))
    if(original) {
      if(normalize(job.title)!==normalize(original.title)||normalize(job.description)!==normalize(original.description)||job.location&&normalize(job.location)!==normalize(original.location)||job.publishedAt&&job.publishedAt!==original.publishedAt||job.publicationLabels?.some(label=>!original.publicationLabels?.includes(label)))throw Error('engine_extraction_metadata_or_job_mismatch')
      return {...job,location:original.location,publishedAt:original.publishedAt,publicationLabels:original.publicationLabels}
    }
    if(!body.includes(normalize(job.title))||!body.includes(normalize(job.description))||!urls.has(job.url)||!urls.has(job.applyUrl)||job.location||job.publishedAt||job.publicationLabels?.length)throw Error('engine_extraction_not_grounded_in_observed_text')
    return job
  })
}
async function checkedArtifact(root:string,reference:{id:string;version:number;sha256:string},sourceId:string) {
  const artifact=await loadArtifact(root,reference);validateForSource(artifact,sourceId)
  const fixtures:EngineFixture[]=JSON.parse(await readFile(join(root,'fixtures',`${artifact.id}-${artifact.version}.json`),'utf8'))
  const evidence=await runEngineFixtures(artifact.code,fixtures,limits)
  if(digest(evidence)!==digest(artifact.fixtures))throw Error('engine_fixture_evidence_changed')
  return {artifact,fixtures}
}

/** One source, persisted Codex handoff and bounded source-local repair. Never writes vacancies. */
export async function executeReasonedSource(input:{runId:string;source:Source;memory:SourceMemory;maxPages:number;maxSourceMs?:number;hintUrls?:string[];previousPositions?:Position[];retryReview?:boolean;previousAttempt?:Result;engineRoot:string;titlePrecheck?:TitlePrecheck},deps:{reader:PageReader;action:(a:SourceAction)=>Promise<void>;reasoner?:CollectionReasoner}) {
  const sourceId=input.source.database!.sourceId,maxMs=input.maxSourceMs??300000,documents:PageDocument[]=[]
  let memory=input.memory
  const startupActions:SourceAction[]=[]
  let engine:EngineArtifact|undefined,fixtures:EngineFixture[]=[]
  if(memory.recipe?.engine) {
    try {({artifact:engine,fixtures}=await checkedArtifact(input.engineRoot,memory.recipe.engine,sourceId))}
    catch(error) {
      const failed=memory.recipe,previous=failed.previous
      if(previous?.engine)({artifact:engine,fixtures}=await checkedArtifact(input.engineRoot,previous.engine,sourceId))
      memory={...memory,recipe:previous??null}
      const action:SourceAction={operation:previous?'engine_binding_rollback':'engine_binding_invalid',url:input.source.url,at:new Date().toISOString(),outcome:'failed',detail:JSON.stringify({failed:failed.engine,restored:previous?.engine??previous?.revision??null,reason:error instanceof Error?error.message:String(error)})}
      startupActions.push(action);await deps.action(action)
    }
  }
  const reader:PageReader={read:async(url,options)=>{
    let page=await deps.reader.read(url,options)
    if(engine) {
      const output=await evaluateEngine(engine.code,snapshot(input.source,page),limits)
      if(output.kind==='parse') {
        page={...page,jobs:groundEngineJobs(page,output.value.jobs).map(j=>({...j,company:input.source.name}))}
      }
    }
    documents.push(page);return page
  }}
  if(engine) {
    const output=await evaluateEngine(engine.code,snapshot(input.source),limits)
    if(output.kind==='plan') {
      const allowed=new Set([input.source.url,...memory.recipe!.listingUrls,...Object.keys(memory.recipe!.controls)])
      if([...output.value.entryUrls,...output.value.reads?.map(r=>r.url)??[]].some(u=>!allowed.has(u)))throw Error('engine_replay_plan_changed_requires_investigation')
      memory={...memory,recipe:{...memory.recipe!,listingUrls:output.value.entryUrls,extraction:output.value.extraction??memory.recipe?.extraction,controls:{...memory.recipe?.controls,...Object.fromEntries((output.value.reads??[]).map(r=>[r.url,r.steps??[]]))}}}
    }
  }
  const start=Date.now()
  let result=input.previousAttempt??await executeSource({...input,memory,maxPages:deps.reasoner?Math.min(40,input.maxPages):input.maxPages},{reader,action:deps.action})
  result.audit.trace!.actions.unshift(...startupActions)
  if(!input.previousAttempt)result.audit.trace!.activeMs=Date.now()-start
  const stamp=()=>{for(const position of result.positions)position.extraction={runId:input.runId,sourceId,recipeRevision:result.audit.trace?.recipe?.revision??result.audit.trace?.recipeRevision,engine:engine?{id:engine.id,version:engine.version,sha256:engine.sha256,sourceId}:undefined};return result}
  const event=async(action:SourceAction)=>{result.audit.trace!.actions.push(action);await deps.action(action)}
  const focusedDocuments=()=>documents.map(p=>({...p,jobs:p.jobs.filter(j=>input.titlePrecheck?.evaluate(j.title).decision!=='excluded')}))
  const valid=()=>result.audit.status==='complete'
  if(!valid()&&deps.reasoner&&!result.audit.accessGate) {
    const previous=result.audit.trace!.investigation
    if(previous&&previous.status!=='pending')return stamp()
    const attempt=previous?.attempts??0
    let remainingReads=input.maxPages-result.audit.trace!.requests,remainingMs=maxMs-(result.audit.trace!.activeMs??0)
    if(attempt>=2||remainingReads<=0||remainingMs<=0)return stamp()
    let request
    try { request=previous?.request??focusedInvestigation({runId:input.runId,source:input.source,audit:structuredClone(result.audit),remainingReads,remainingMs,attempt:attempt+1},focusedDocuments(),attempt>0) }
    catch(error) {
      result.audit.terminal=false
      result.audit.issues.push('Source investigation pending: '+(error instanceof Error?error.message:String(error)))
      await event({operation:'investigation_packet_pending',url:input.source.url,at:new Date().toISOString(),outcome:'failed',detail:'Full inspected results retained; packet requires a bounded evidence review.'})
      return stamp()
    }
    const proposal=await deps.reasoner.investigate(request)
    if(!proposal){result.audit.terminal=false;result.audit.trace!.investigation={status:'pending',request,attempts:attempt};await event({operation:'investigation_requested',url:input.source.url,at:new Date().toISOString(),outcome:'ok',detail:request.id});return stamp()}
    const inspection=await deps.reasoner.inspections?.(request)
    if(inspection) {
      if(inspection.calls>remainingReads||inspection.activeMs>remainingMs)throw Error('source_investigation_budget_exhausted')
      remainingReads-=inspection.calls;remainingMs-=inspection.activeMs
      result.audit.trace!.requests+=inspection.calls;result.audit.trace!.activeMs=(result.audit.trace!.activeMs??0)+inspection.activeMs
      for(const action of inspection.actions)await event(action)
      documents.push(...inspection.observations)
    }
    await event({operation:'proposal_loaded',url:input.source.url,at:new Date().toISOString(),outcome:'ok',detail:JSON.stringify({requestId:request.id,proposalHash:digest(proposal),model:proposal.model,reason:proposal.reason,verifiedLinks:proposal.verifiedLinks??[],pausedMs:Math.max(0,Date.now()-Date.parse(result.audit.trace!.finishedAt)-(inspection?.activeMs??0))})})
    if(proposal.action==='defer'){result.audit.terminal=true;result.audit.issues.push('Codex investigation deferred: '+proposal.reason);result.audit.trace!.investigation={status:'deferred',request,attempts:attempt};return stamp()}
    let plan:RepairPlan|undefined=proposal.plan
    if(proposal.engine) {
      ({artifact:engine,fixtures}=await checkedArtifact(input.engineRoot,proposal.engine,sourceId))
      const output=await evaluateEngine(engine.code,snapshot(input.source,request.observations[0]),limits)
      if(output.kind==='plan')plan=output.value
    }
    if(!plan)throw Error('collection_engine_plan_required')
    validateRepairPlan(plan,{...request,observations:[...request.observations,...inspection?.observations??[]]},proposal)
    if(remainingReads<1||remainingMs<1000)throw Error('source_investigation_budget_exhausted')
    const candidate:SourceRecipe={version:1,revision:digest(plan),verifiedAt:new Date().toISOString(),listingUrls:plan.entryUrls,methods:['codex-repair'],controls:Object.fromEntries((plan.reads??[]).map(r=>[r.url,r.steps??[]])),checks:{substantiveDescriptions:true,paginationComplete:true},origin:'observed',extraction:plan.extraction,...(engine?{engine:{id:engine.id,version:engine.version,sha256:engine.sha256,sourceId}}:{}),repairProvenance:{requestId:request.id,model:proposal.model,origin:proposal.origin}}
    candidate.revision=digest({listingUrls:candidate.listingUrls,controls:candidate.controls,extraction:candidate.extraction,engine:candidate.engine,checks:candidate.checks})
    const repairStart=Date.now(),before=result
    result=await executeSource({...input,memory:{...input.memory,recipe:candidate,state:{...input.memory.state,review:undefined}},maxPages:remainingReads,maxSourceMs:remainingMs},{reader,action:deps.action})
    const trace=result.audit.trace!
    trace.requests+=before.audit.trace!.requests;trace.activeMs=(before.audit.trace!.activeMs??0)+Date.now()-repairStart
    trace.startedAt=before.audit.trace!.startedAt;trace.actions=[...before.audit.trace!.actions,...trace.actions]
    trace.repaired=true;trace.repairOutcome=valid()?'succeeded':'failed'
    if(valid()) {
      if(engine)await validateEngineCandidate({artifact:engine,sourceId,fixtures,liveEvidence:{coverage:result.audit.status,paginationComplete:result.audit.status==='complete',explicitlyEmpty:result.audit.status==='complete'&&!result.positions.length},liveResult:{url:result.audit.pages[0],text:result.positions.map(p=>p.description).join('\n'),links:[],jobs:result.positions.map(({title,location,description,url,applyUrl,publishedAt})=>({title,location,description,url,applyUrl,...(publishedAt?{publishedAt}:{})}))}},limits)
      await event({operation:'repair_validated',url:result.audit.pages[0],at:new Date().toISOString(),outcome:'ok',detail:JSON.stringify({recipeRevision:candidate.revision,engine:candidate.engine,requestId:request.id})})
      trace.recipe={...candidate,verifiedAt:trace.finishedAt,...(input.memory.recipe?{previous:input.memory.recipe}:{})}
      trace.recipeRevision=candidate.revision
      trace.investigation={status:'repaired',request,attempts:attempt+1}
    } else {
      result.positions=[...new Map([...before.positions,...result.positions].map(p=>[p.id,p])).values()]
      result.audit.found=result.positions.length
      result.audit.pages=[...new Set([...before.audit.pages,...result.audit.pages])]
      result.audit.issues=[...new Set([...before.audit.issues,...result.audit.issues])]
      const canRetry=attempt+1<2&&trace.requests<input.maxPages&&trace.activeMs<maxMs&&!result.audit.accessGate
      const clean=structuredClone(result.audit);delete clean.trace!.investigation
      const next=focusedInvestigation({runId:input.runId,source:input.source,audit:clean,remainingReads:input.maxPages-trace.requests,remainingMs:maxMs-trace.activeMs,attempt:attempt+2},focusedDocuments(),true)
      trace.investigation={status:canRetry?'pending':'exhausted',request:next,attempts:attempt+1};result.audit.terminal=!canRetry
      if(canRetry){await deps.reasoner.investigate(next);await event({operation:'investigation_requested',url:input.source.url,at:new Date().toISOString(),outcome:'ok',detail:next.id})}
    }
  }
  if(valid()&&memory.recipe&&(memory.recipe.engine||memory.recipe.repairProvenance)&&!result.audit.trace!.investigation)result.audit.trace!.recipe={...memory.recipe,verifiedAt:result.audit.trace!.finishedAt}
  return stamp()
}
