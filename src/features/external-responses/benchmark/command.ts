import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { atomicJson, createFileStore, safeId } from '../infrastructure/store.ts'
import { createBrowserSession, parseBrowserDriver } from '../infrastructure/browser.ts'
import { createPageReader } from '../vacancy_collection/page-reader.ts'
import { createSessionReasoner } from '../vacancy_collection/session-reasoner.ts'
import { openCollectionCheckpoint } from '../vacancy_collection/checkpoint.ts'
import { executeReasonedSource } from '../vacancy_collection/reasoned-source.ts'
import { emptyMemory } from '../vacancy_collection/source-memory.ts'
import { createTitlePrecheck } from '../vacancy_collection/title-precheck.ts'
import { classifyWithReuse, seedReviewedCache } from '../stack_classification/reuse.ts'
import { createReviewedAssessors } from '../stack_classification/reviewed-assessor.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'
import { generateCollectionReport } from '../reporting/collection.ts'
import { createCodexAppServer } from '../infrastructure/codex-app-server.ts'
import { createBudgetWatchdog, runGuardedTask } from '../infrastructure/budget-watchdog.ts'
import { createQuotaGuard, loadBudgetPolicy, readGuardState } from '../infrastructure/quota-guard.ts'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { isLinkedInUrl } from '../infrastructure/navigation-policy.ts'
import { assertCompanyMayStart, recordCompanyDiagnosis, recordCompanyOutcome, recordCompanySuccessTargetOutcome } from './company-failure-gate.ts'
import { openBenchmarkCheckpoint } from './checkpoint.ts'
import type { BenchmarkCheckpoint, BenchmarkSourceResult } from './checkpoint.ts'
import type { PageReader, Source, SourceAudit } from '../types.ts'
import type { VacancyCollection } from '../vacancy_collection/index.ts'

const expectedColdCompanies=Array.from({length:20},(_,i)=>String(140+i)),expectedTransferCompanies=['172','225','196','203','167','173'],expectedStacks=['2','5','7']
export type GuardedBenchmarkDependencies={createBrowser?:(options:any)=>Promise<any>;createReader?:(options:any)=>PageReader;acquireCollectionLock?:()=>Promise<()=>Promise<void>>;readRateLimit?:()=>Promise<unknown>;closeRateLimit?:()=>Promise<void>;now?:()=>number;pollIntervalMs?:number}
const optionalJson=async<T>(path:string):Promise<T|undefined>=>{try{return JSON.parse(await readFile(path,'utf8'))}catch(error:any){if(error?.code==='ENOENT')return undefined;throw error}}
const clean=(value:unknown)=>String(value??'').replace(/[\r\n|]/g,' ')
const transferSource=(value:any):Source=>({name:String(value.name),url:String(value.url),database:{companyId:String(value.company_id),sourceId:String(value.source_id),applicationRoute:'standard_workflow'}})

function explicitFollowupCompanies(frozen:any,policy:any) {
  const approved=policy.approvedCompanyIds
  if(!Array.isArray(approved)||!approved.length||approved.some((id:unknown)=>typeof id!=='string'||!id)||new Set(approved).size!==approved.length||JSON.stringify(policy.coldCompanyIds)!==JSON.stringify(approved))throw Error('benchmark_explicit_followup_policy_invalid')
  const companyIds=frozen.catalog?.companyIds?.map(String),manifestCompanyIds=frozen.catalog?.companies?.map((company:any)=>String(company.id)),stackIds=frozen.scope?.stacks?.map((stack:any)=>String(stack.databaseId))
  if(JSON.stringify(companyIds)!==JSON.stringify(approved)||JSON.stringify(manifestCompanyIds)!==JSON.stringify(approved)||JSON.stringify(stackIds)!==JSON.stringify(expectedStacks)||JSON.stringify(policy.stackIds)!==JSON.stringify(expectedStacks))throw Error('benchmark_frozen_scope_changed')
  const approvedSet=new Set(approved),sources=frozen.catalog?.sources,deferred=frozen.catalog?.deferred,issues=frozen.catalog?.issues
  if(!Array.isArray(sources)||!Array.isArray(deferred)||!Array.isArray(issues)||sources.some((source:any)=>!approvedSet.has(String(source?.database?.companyId)))||deferred.some((item:any)=>!approvedSet.has(String(item?.companyId)))||issues.some((issue:unknown)=>{const match=/^company:([^:]+):/.exec(String(issue));return !match||!approvedSet.has(match[1])}))throw Error('benchmark_frozen_scope_leakage')
  return approved
}

function testedBindings(value:unknown,sources:Source[]) {
  if(value===undefined)return new Map<string,any>()
  const bindings=Array.isArray(value)?value:(value as any)?.bindings
  if(!Array.isArray(bindings))throw Error('benchmark_tested_engine_bindings_invalid')
  const counts=new Map<string,number>(),sourceIds=new Set(sources.map(source=>source.database!.sourceId)),result=new Map<string,any>()
  for(const binding of bindings) {
    const sourceId=String(binding?.sourceId??'')
    if(!sourceIds.has(sourceId)||typeof binding?.id!=='string'||!Number.isSafeInteger(binding?.version)||!/^[a-f0-9]{64}$/i.test(binding?.sha256??'')||binding?.tested!==true)throw Error('benchmark_tested_engine_bindings_invalid')
    counts.set(sourceId,(counts.get(sourceId)??0)+1);if(counts.get(sourceId)!>2)throw Error('benchmark_engine_candidate_limit_exceeded')
    if(!result.has(sourceId))result.set(sourceId,binding)
  }
  if(/"(?:observations|decisions|resultCaches|results|httpValidators)"\s*:/i.test(JSON.stringify(value)))throw Error('benchmark_transfer_result_cache_forbidden')
  return result
}

function collectionFromCheckpoint(runId:string,sources:Source[],scope:any,companies:string[],deferred:any[],sourceIssues:string[],state:BenchmarkCheckpoint):VacancyCollection {
  const results=Object.values(state.sourceResults)
  const audits:SourceAudit[]=sources.map(source=>results.find(result=>result.audit.source.database?.sourceId===source.database?.sourceId)?.audit??{source,status:'unavailable',terminal:false,pages:[],found:0,issues:['Benchmark source is unattempted']})
  const positions=[...new Map(results.flatMap(result=>result.positions).map(position=>[position.id,position])).values()]
  return {version:1,runId,sources:structuredClone(sources),positions:structuredClone(positions),audit:structuredClone(audits),scope:structuredClone(scope),createdAt:state.createdAt,sourceIssues:[...sourceIssues],deferredSources:deferred.map(item=>({id:String(item.id),companyId:item.companyId===null?null:String(item.companyId),reason:String(item.reason)})),scan:{status:state.status==='complete'?'complete':state.status==='running'?'running':'interrupted',configHash:state.configHash,companies:companies.map(id=>({id,name:sources.find(source=>source.database?.companyId===id)?.name??`Company ${id}`})),startedAt:state.createdAt,...(state.status==='complete'?{finishedAt:state.updatedAt}:{})}}
}

async function persistAccepted(directory:string,classified:Awaited<ReturnType<typeof classifyWithReuse>>['classified']) {
  const matched=new Set(classified.stacks.flatMap(stack=>classified.groups[stack.id]?.matchedIds??[])),accepted=classified.collection.positions.filter(position=>matched.has(position.id)&&classified.globalDecisions?.[position.id]?.decision==='eligible')
  await atomicJson(join(directory,'accepted-vacancies.json'),{version:1,runId:classified.collection.runId,count:accepted.length,vacancies:accepted})
}

async function persistClassification(input:{directory:string;runId:string;sources:Source[];scope:any;companies:string[];deferred:any[];sourceIssues:string[];state:BenchmarkCheckpoint;assessmentsPath?:string;reviewedCachePath?:string;final:boolean}) {
  const collection=collectionFromCheckpoint(input.runId,input.sources,input.scope,input.companies,input.deferred,input.sourceIssues,input.state),rules=await loadSelectionRules(),cachePath=join(input.directory,'semantic-cache.json'),cache=await optionalJson<Record<string,any>>(cachePath)??{}
  let assessment:any,provenance:any
  if(input.assessmentsPath&&input.final) {const reviewed=createReviewedAssessors(JSON.parse(await readFile(resolve(input.assessmentsPath),'utf8')),collection,rules);provenance=reviewed.provenance;assessment=async(position:any,stacks:any[])=>({global:await reviewed.assessGlobal(position),stacks:Object.fromEntries(await Promise.all(stacks.map(async(stack:any)=>[stack.id,await reviewed.assess(position,stack)])))})}
  const seed=input.reviewedCachePath?await optionalJson<any>(input.reviewedCachePath):undefined
  const fallbackCache=seed?seedReviewedCache(seed,rules,collection.scope!.stacks):undefined
  const result=await classifyWithReuse({collection,rules,cache,policy:input.reviewedCachePath?'reviewed-v1':'guarded-benchmark-semantic-v1',...(fallbackCache?{fallbackCache}:{}),...(provenance?{assessmentProvenance:provenance}:{})},{...(assessment?{assess:assessment}:{})})
  await atomicJson(cachePath,{...cache,...result.updates});await atomicJson(join(input.directory,'classified.json'),result.classified);await persistAccepted(input.directory,result.classified)
  const generated=generateCollectionReport(result.classified);await writeFile(join(input.directory,'collection-report.md'),generated.markdown+'\n','utf8');await writeFile(join(input.directory,'collection-report.csv'),generated.csv+'\n','utf8')
  return result.classified
}

async function persistBenchmarkReport(input:{directory:string;mode:'cold'|'transfer';runId:string;companies:string[];sources:Source[];deferred:any[];state:BenchmarkCheckpoint;quota:any;classified?:any;stopReason?:string;families?:Map<string,string>;successTarget?:number}) {
  const records=new Map(input.state.failureGate.records.map(record=>[record.companyId,record])),pending=new Set(input.classified?.evaluation?.pendingIds??[])
  const companyRows=input.companies.map(companyId=>{const record=records.get(companyId),companySources=input.sources.filter(source=>source.database?.companyId===companyId),unsupported=input.deferred.filter(item=>String(item.companyId)===companyId).length,sourceRows=companySources.map(source=>{const id=source.database!.sourceId,result=input.state.sourceResults[id] as BenchmarkSourceResult|undefined,budget=input.state.sourceBudgets[id]??{reads:0,activeMs:0,engineCandidates:0};return {sourceId:id,name:source.name,status:result?.audit.status??'unattempted',terminal:!!result&&result.audit.terminal!==false,repair:result?.audit.trace?.repairOutcome??(result?.audit.trace?.repaired?'attempted':'none'),reuse:result?.reuse??(input.mode==='cold'?'cold':'unavailable'),...budget}}),status=record?.failed?'failed':input.state.completedCompanyIds.includes(companyId)?'clean':sourceRows.some(row=>row.status!=='unattempted')?'interrupted':'unattempted';return {companyId,status,unsupported,expectedFamily:input.families?.get(companyId),diagnosis:record?.diagnosis?.status??'none',reasons:record?.reasons??[],sources:sourceRows}})
  const report={version:1,runId:input.runId,mode:input.mode,status:input.state.status,stopReason:input.stopReason??input.state.stopReason??null,successfulCompanyCount:input.state.successfulCompanyCount,successfulCompanyIds:input.state.successfulCompanyIds,successTarget:input.successTarget??null,quota:{status:input.quota?.status??'unknown',reason:input.quota?.reason??'unknown',usedPercent:input.quota?.observation?.usedPercent??null},failureStreak:input.state.failureGate.consecutiveFailures,hardStopped:input.state.failureGate.hardStopped,classification:{pending:pending.size,cacheHits:input.classified?.evaluation?.hits??0,sessionReviews:input.classified?.evaluation?.sessionReviews??0,accepted:new Set(input.classified?.stacks?.flatMap((stack:any)=>input.classified.groups[stack.id]?.matchedIds??[])??[]).size},companies:companyRows}
  await atomicJson(join(input.directory,'benchmark-report.json'),report)
  const lines=[`# Guarded benchmark ${clean(input.runId)}`,'',`Mode: ${input.mode}. Status: ${input.state.status}. Stop reason: ${clean(report.stopReason??'none')}. Quota: ${clean(report.quota.status)} / ${clean(report.quota.reason)} / ${clean(report.quota.usedPercent)}%.`,'',`Successful companies: ${report.successfulCompanyCount}${report.successTarget===null?'':` / ${report.successTarget}`}.`,'',`Classification: ${report.classification.pending} pending; ${report.classification.cacheHits} this-run cache hits; ${report.classification.sessionReviews} session reviews; ${report.classification.accepted} accepted. Pending is not evidence of no matches.`,'',`Company failure streak: ${report.failureStreak}; hard stopped: ${report.hardStopped}.`,'','| Company | Status | Unsupported | Family hypothesis | Diagnosis | Reasons |','|---|---|---:|---|---|---|',...companyRows.map(row=>`| ${row.companyId} | ${row.status} | ${row.unsupported} | ${clean(row.expectedFamily??'n/a')} | ${row.diagnosis} | ${clean(row.reasons.join('; '))} |`),'','| Company / source | Coverage | Terminal | Reads | Active ms | Engines | Repair | Reuse |','|---|---|---|---:|---:|---:|---|---|',...companyRows.flatMap(company=>company.sources.map(source=>`| ${company.companyId} / ${source.sourceId} ${clean(source.name)} | ${source.status} | ${source.terminal} | ${source.reads} | ${source.activeMs} | ${source.engineCandidates} | ${source.repair} | ${source.reuse} |`)),'']
  await writeFile(join(input.directory,'benchmark-report.md'),lines.join('\n'),'utf8');return report
}

export async function guardedBenchmarkCommand(args:string[],deps:GuardedBenchmarkDependencies={}) {
  const flag=(name:string)=>args.includes('--'+name),arg=(name:string,fallback?:string)=>{const i=args.indexOf('--'+name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw Error('missing_flag_value:'+name);return args[i+1]}
  const campaign=resolve(arg('campaign','logs/external-responses/guarded-benchmark-20260929')!),mode=arg('mode') as 'cold'|'transfer'
  if(!['cold','transfer'].includes(mode))throw Error('benchmark_mode_required_cold_or_transfer')
  if(arg('diagnose-company')&&(!flag('execute')||!flag('resume')))throw Error('benchmark_diagnosis_requires_execute_resume')
  const frozen=JSON.parse(await readFile(join(campaign,'frozen-scope.json'),'utf8')),policy=JSON.parse(await readFile(join(campaign,'execution-policy.json'),'utf8')),budgetFile=join(campaign,'budget.json'),explicitFollowup=policy.scopeKind==='explicit_followup'
  if(policy.scopeKind!==undefined&&!explicitFollowup)throw Error('benchmark_scope_kind_invalid')
  const boundedBatch=explicitFollowup&&policy.failurePolicy==='bounded_batch_skip_unresolved'
  const successTargetPolicy=explicitFollowup&&(policy.failurePolicy==='continue_until_success_target_or_budget'||boundedBatch),successTarget=successTargetPolicy?policy.stopAfterSuccessfulCompanies:undefined
  if(policy.maxConcurrentActions!==1||policy.maxReaderCallsPerSource!==200||policy.maxActiveCrawlMsPerSource!==900000||policy.maxEngineCandidatesPerSource!==2||policy.paidApiCalls!==0||policy.applications!==false||policy.maxExpansions!==1||policy.repairResetsFailureStreak!==false)throw Error('benchmark_execution_policy_changed')
  if(successTargetPolicy?((boundedBatch?successTarget!==5||policy.approvedCompanyIds?.length!==5||policy.companyRepairPoints!==0.5:successTarget!==3)||policy.consecutiveCompanyFailureLimit!==null):(policy.consecutiveCompanyFailureLimit!==3||policy.failurePolicy!==undefined||policy.stopAfterSuccessfulCompanies!==undefined))throw Error('benchmark_execution_policy_changed')
  if(explicitFollowup&&mode!=='cold')throw Error('benchmark_explicit_followup_requires_cold')
  const budget=explicitFollowup?await loadBudgetPolicy(budgetFile):JSON.parse(await readFile(budgetFile,'utf8'))
  if(budget.campaignId!==policy.campaignId)throw Error('benchmark_budget_campaign_mismatch')
  if(!explicitFollowup&&(budget.baseline?.usedPercent!==4||budget.pauseAtPercent!==8||budget.stopAtPercent!==9))throw Error('benchmark_original_budget_changed')
  const frozenCompanyIds=explicitFollowup?explicitFollowupCompanies(frozen,policy):frozen.catalog?.companyIds?.map(String),stackIds=frozen.scope?.stacks?.map((stack:any)=>String(stack.databaseId))
  if(!explicitFollowup&&(JSON.stringify(frozenCompanyIds)!==JSON.stringify(expectedColdCompanies)||JSON.stringify(stackIds)!==JSON.stringify(expectedStacks)))throw Error('benchmark_frozen_scope_changed')
  let companies:string[],sources:Source[],deferred:any[],sourceIssues:string[],families:Map<string,string>|undefined
  if(mode==='cold'){companies=explicitFollowup?frozenCompanyIds:expectedColdCompanies;sources=frozen.catalog.sources;deferred=frozen.catalog.deferred;sourceIssues=frozen.catalog.issues;if(arg('engine-bindings'))throw Error('cold_benchmark_ignores_engine_bindings')}
  else {const transfer=JSON.parse(await readFile(join(campaign,'transfer-scope.json'),'utf8'));companies=transfer.companies?.map((company:any)=>String(company.companyId));if(JSON.stringify(companies)!==JSON.stringify(expectedTransferCompanies)||transfer.companies.some((company:any)=>company.replacementAllowed!==false||company.familyValidation!=='pending_independent_collection'))throw Error('benchmark_transfer_scope_changed');sources=transfer.companies.flatMap((company:any)=>company.sources.map(transferSource));deferred=[];sourceIssues=[];families=new Map(transfer.companies.map((company:any)=>[String(company.companyId),String(company.expectedFamily)]))}
  if(sources.some(source=>isLinkedInUrl(source.url)))throw Error('benchmark_linkedin_source_forbidden')
  const requested=arg('company-ids')?.split(',').map(String).filter(Boolean);if(requested&&JSON.stringify(requested)!==JSON.stringify(companies))throw Error(mode==='cold'?'cold_benchmark_requires_original_twenty_companies':'transfer_benchmark_requires_exact_frozen_six')
  const rawBindings=arg('engine-bindings')?JSON.parse(await readFile(resolve(arg('engine-bindings')!),'utf8')):undefined,bindings=testedBindings(rawBindings,sources),runId=safeId(arg('run',`${mode}-benchmark`)!),root=resolve(arg('storage',join(campaign,'isolated'))!),directory=join(root,runId)
  const configuration={campaignId:policy.campaignId,mode,companyIds:companies,stackIds,sources,deferred,sourceIssues,policyHash:JSON.stringify(policy),budgetFile:policy.budgetFile,...(explicitFollowup?{budgetPolicy:budget}:{}),engineBindings:mode==='transfer'?rawBindings:undefined,ignoredState:mode==='cold'?['observations','decisions','recipes','generated_bindings','learned_hints','http_validators']:['observations','decisions','result_caches','learned_hints','http_validators'],builtInAtsReaders:true,browserProfile:join(directory,'browser-profile')}
  const replayId=arg('replay-run'), replay=replayId?await optionalJson<BenchmarkCheckpoint>(join(root,safeId(replayId),'benchmark-checkpoint.json')):undefined
  if(replayId&&(!boundedBatch||!replay||replay.campaignId!==policy.campaignId||replay.completedCompanyIds.length!==companies.length||companies.some(id=>!replay.completedCompanyIds.includes(id))))throw Error('benchmark_replay_scope_invalid')
  if(replay){configuration.ignoredState=['observations','decisions','http_validators'];(configuration as any).replayRun=replayId}
  if(mode==='transfer'){const cold=await optionalJson<BenchmarkCheckpoint>(join(root,arg('cold-run','cold-benchmark')!,'benchmark-checkpoint.json'));if(cold?.failureGate?.hardStopped||cold?.status==='hard_stopped')throw Error('benchmark_cold_failure_gate_hard_stopped')}
  await mkdir(directory,{recursive:true});const checkpoint=await openBenchmarkCheckpoint({path:join(directory,'benchmark-checkpoint.json'),campaignId:policy.campaignId,mode,configuration,resume:flag('resume')})
  const preflight={version:1,status:'pending',reason:flag('execute')?'benchmark_execution_requested':'benchmark_runner_not_started',runId,mode,companyIds:companies,stackIds,browserProfile:configuration.browserProfile,storageDirectory:directory,checkpoint:checkpoint.get(),applications:false,productionSqlWrites:false};await atomicJson(join(directory,'preflight.json'),preflight)
  if(!flag('execute')){console.log(JSON.stringify(preflight));return preflight}
  const cancellation=JSON.parse(await readFile(join(campaign,'cancellation-preflight.json'),'utf8'));if(cancellation.passed!==true||cancellation.status!=='interrupted'||cancellation.requestedInterrupt!==true||cancellation.paidApiCalls!==0)throw Error('benchmark_owned_turn_cancellation_preflight_required')
  // The original campaign ledger spans implementation, A/B, cold and transfer phases.
  // Tests must isolate their campaign directory instead of resetting production quota history.
  const appServer=deps.readRateLimit?undefined:createCodexAppServer(),readRateLimit=deps.readRateLimit??(()=>appServer!.readPrimaryRateLimit()),quotaPolicy=await loadBudgetPolicy(budgetFile),quotaStatePath=join(campaign,'budget-status.json'),guard=createQuotaGuard(quotaPolicy,{statePath:quotaStatePath,initialState:await readGuardState(quotaStatePath),now:deps.now})
  let pageCheckpoint:Awaited<ReturnType<typeof openCollectionCheckpoint>>|undefined
  let context:Awaited<ReturnType<typeof createBrowserSession>>|undefined,stopReason:string|undefined,classified:any
  const watchdog=createBudgetWatchdog({guard,readRateLimit,cancelOwnedWork:async()=>{await context?.close()},reportPath:join(directory,'watchdog-report.json'),pollIntervalMs:deps.pollIntervalMs,now:deps.now})
  const persist=async(final=false)=>{classified=await persistClassification({directory,runId,sources,scope:frozen.scope,companies,deferred,sourceIssues,state:checkpoint.get(),assessmentsPath:arg('assessments'),...(replayId?{reviewedCachePath:join(root,safeId(replayId),'reviewed-classified.json')}:{}),final});return persistBenchmarkReport({directory,mode,runId,companies,sources,deferred,state:checkpoint.get(),quota:guard.latest(),classified,stopReason,families,successTarget})}
  if(successTargetPolicy&&checkpoint.get().successfulCompanyCount>=successTarget){let state=checkpoint.get();stopReason=state.stopReason??'successful_company_target_reached';if(state.status!=='complete'||state.stopReason!==stopReason){state.status='complete';state.stopReason=stopReason;await checkpoint.replace(state)}const report=await persist(true);await (deps.closeRateLimit?.()??appServer?.close()??Promise.resolve());console.log(JSON.stringify({runId,mode,status:'complete',reason:stopReason,report:join(directory,'benchmark-report.md'),quota:null}));return report}
  try {
    await runGuardedTask(watchdog,{live:true},async control=>{
      let state=checkpoint.get();state.status='running';await checkpoint.replace(state)
      const release=await (deps.acquireCollectionLock?.()??createFileStore(resolve('storage/external-responses'),campaign).lock('shared-vacancy-collection'))
      try {
        context=await (deps.createBrowser??createBrowserSession)({profilePath:configuration.browserProfile,headless:flag('headless'),driver:parseBrowserDriver(arg('browser-driver','playwright'))})
        const pageDirectory=join(directory,'reader-checkpoints')
        pageCheckpoint=await openCollectionCheckpoint({directory:pageDirectory,identity:{runId,configHash:checkpoint.get().configHash,driver:arg('browser-driver','playwright')},resume:!!await optionalJson(join(pageDirectory,'manifest.json'))})
        const reader=(deps.createReader??createPageReader)({context:context!,evidenceDirectory:join(directory,'evidence'),onPage:async()=>{}}),titlePrecheck=createTitlePrecheck(await loadSelectionRules(),frozen.scope),baseReasoner=createSessionReasoner(join(directory,'investigations'))
        const quotaReady=async()=>{const admission=watchdog.admission();if(control.signal.aborted||!admission.allowed){stopReason=control.signal.aborted?String((control.signal.reason as Error)?.message??'quota_monitor_interrupted'):admission.reason;return false}return true}
        const runSource=async(source:Source,previous?:BenchmarkSourceResult)=>{
          const sourceId=source.database!.sourceId,binding=bindings.get(sourceId),memory=emptyMemory()
          if(replay?.sourceResults[sourceId]?.audit.trace?.recipe)memory.recipe=replay.sourceResults[sourceId].audit.trace!.recipe!
          if(binding)memory.recipe={version:1,revision:digest({sourceId,binding}),verifiedAt:new Date(deps.now?.()??Date.now()).toISOString(),listingUrls:[source.url],methods:['tested-engine-binding'],controls:{},checks:{substantiveDescriptions:true,paginationComplete:true},origin:'observed',engine:{id:binding.id,version:binding.version,sha256:binding.sha256,sourceId}}
          const budgetNow=checkpoint.get().sourceBudgets[sourceId]??{reads:0,activeMs:0,engineCandidates:0},remainingReads=200-budgetNow.reads,remainingMs=900000-budgetNow.activeMs
          if(remainingReads<=0||remainingMs<=0)throw Error('benchmark_source_budget_exhausted')
          const wrapped:PageReader={read:async(url,options={})=>{if(!await quotaReady())throw Error('benchmark_quota_stop');const counted=await checkpoint.consumeSourceBudget(sourceId,{reads:1}),started=deps.now?.()??Date.now();let last=started;await checkpoint.recordSourceAction(sourceId,{operation:'reader_call_started',url,at:new Date(started).toISOString(),outcome:'ok',detail:String(counted.reads)});const account=async()=>{const current=deps.now?.()??Date.now(),delta=Math.max(0,Math.floor(current-last));last=current;if(delta)await checkpoint.consumeSourceBudget(sourceId,{activeMs:delta})};try{const page=await reader.read(url,{...options,onAction:async action=>{await account();await options.onAction?.(action)}});await account();await atomicJson(join(directory,'audit','pages',sourceId,`read-${counted.reads}.json`),page);return page}catch(error){await account();throw error}}}
          const reasoner={...baseReasoner,investigate:async(request:any)=>{const proposal=await baseReasoner.investigate(request);if(proposal?.engine)await checkpoint.consumeSourceBudget(sourceId,{engineCandidates:1});return proposal}}
          const result=await executeReasonedSource({runId,source,memory,maxPages:boundedBatch?Math.min(40,remainingReads):remainingReads+(previous?.audit.trace?.investigation?(previous.audit.trace.requests??0):0),maxSourceMs:boundedBatch?Math.min(180000,remainingMs):remainingMs+(previous?.audit.trace?.investigation?(previous.audit.trace.activeMs??0):0),previousAttempt:previous?.audit.trace?.investigation?{positions:previous.positions,audit:previous.audit}:undefined,engineRoot:resolve('src/features/external-responses/vacancy_collection/engines'),titlePrecheck},{reader:pageCheckpoint!.reader(wrapped),action:action=>checkpoint.recordSourceAction(sourceId,action),...(boundedBatch?{}:{reasoner})}),saved:BenchmarkSourceResult={positions:result.positions,audit:result.audit,reuse:replay&&memory.recipe?'recipe_replay':mode==='cold'?'cold':binding?'tested_binding':'unavailable'}
          if(boundedBatch&&result.audit.status!=='complete'){
            result.audit.terminal=true
            const reason=result.audit.accessGate?'access_review_deferred_no_registration':'company_repair_skipped_quota_precision_insufficient_0_5_points'
            result.audit.issues.push(reason)
            await checkpoint.recordSourceAction(sourceId,{operation:'repair_skipped',url:source.url,at:new Date().toISOString(),outcome:'failed',detail:reason})
          }
          await checkpoint.saveSourceResult(sourceId,saved);await atomicJson(join(directory,'audit','sources',sourceId+'.json'),saved);return saved
        }
        state=checkpoint.get();const pending=state.failureGate.records.find(record=>record.diagnosis?.status==='pending')
        if(pending){if(!await quotaReady())return;const requestedDiagnosis=arg('diagnose-company');if(!requestedDiagnosis){state.status='paused';await checkpoint.replace(state);stopReason='company_diagnosis_required';return}if(requestedDiagnosis!==pending.companyId)throw Error('benchmark_diagnosis_company_mismatch');let repaired=true;const failedSources=sources.filter(source=>source.database?.companyId===pending.companyId).filter(source=>{const result=checkpoint.get().sourceResults[source.database!.sourceId];return result&&(result.audit.status!=='complete'||result.audit.terminal!==true||result.audit.trace?.repaired)});if(!failedSources.length)repaired=false;for(const source of failedSources){if(!await quotaReady())return;const prior=checkpoint.get().sourceResults[source.database!.sourceId],result=await runSource(source,prior);if(result.audit.status!=='complete'||result.audit.terminal!==true)repaired=false}state=checkpoint.get();const diagnosis=recordCompanyDiagnosis(state.failureGate,pending.companyId,repaired,guard.latest().status==='ready'?'ready':guard.latest().status==='hard_stopped'?'hard_stopped':'admission_stopped');state.failureGate=diagnosis.state;state.status=diagnosis.action==='quota_stop'?'paused':'running';await checkpoint.replace(state);if(diagnosis.action==='quota_stop'){stopReason=guard.latest().reason;return}}
        else if(arg('diagnose-company'))throw Error('benchmark_failure_diagnosis_not_pending')
        for(const companyId of companies){state=checkpoint.get();if(state.completedCompanyIds.includes(companyId))continue;assertCompanyMayStart(state.failureGate);if(!await quotaReady())return;const companySources=sources.filter(source=>source.database?.companyId===companyId)
          for(const source of companySources){if(checkpoint.get().sourceResults[source.database!.sourceId])continue;try{await runSource(source)}catch(error){if(guard.latest().status!=='ready'||watchdog.signal.aborted){stopReason=guard.latest().reason;return}const at=new Date(deps.now?.()??Date.now()).toISOString(),audit:SourceAudit={source,status:'unavailable',terminal:false,pages:[],found:0,issues:[error instanceof Error?error.message:String(error)],trace:{mode:'fresh',actions:[],startedAt:at,finishedAt:at,requests:checkpoint.get().sourceBudgets[source.database!.sourceId]?.reads??0,activeMs:checkpoint.get().sourceBudgets[source.database!.sourceId]?.activeMs??0}};await checkpoint.saveSourceResult(source.database!.sourceId,{positions:[],audit,reuse:mode==='cold'?'cold':bindings.has(source.database!.sourceId)?'tested_binding':'unavailable'})}}
          if(guard.latest().status!=='ready'){stopReason=guard.latest().reason;return}state=checkpoint.get();const outcomes=companySources.map(source=>{const result=state.sourceResults[source.database!.sourceId];return {sourceId:source.database!.sourceId,status:result?.audit.status??'unavailable',terminal:!!result&&result.audit.terminal!==false,repairAttempted:result?.audit.trace?.repaired===true,repairSucceeded:result?.audit.trace?.repairOutcome==='succeeded'}}),unsupportedSources=deferred.filter(item=>String(item.companyId)===companyId).length,outcome={kind:'live' as const,companyId,sources:outcomes,unsupportedSources,matchedVacancies:Object.values(state.sourceResults).filter(result=>result.audit.source.database?.companyId===companyId).reduce((sum,result)=>sum+result.positions.length,0)},gate=successTargetPolicy?recordCompanySuccessTargetOutcome(state.failureGate,outcome,'ready'):recordCompanyOutcome(state.failureGate,outcome,'ready'),successful=successTargetPolicy&&'successful' in gate&&gate.successful;state.failureGate=gate.state;state.completedCompanyIds.push(companyId);if(successful){state.successfulCompanyIds.push(companyId);state.successfulCompanyCount=state.successfulCompanyIds.length}const targetReached=successTargetPolicy&&state.successfulCompanyCount>=successTarget;state.status=targetReached?'complete':gate.action==='hard_stop'?'hard_stopped':gate.action==='pause_for_diagnosis'?'paused':'running';state.stopReason=targetReached?'successful_company_target_reached':undefined;await checkpoint.replace(state);stopReason=targetReached?'successful_company_target_reached':gate.action==='continue'?undefined:gate.action==='hard_stop'?'third_consecutive_company_failure':'company_diagnosis_required';if(gate.action==='pause_for_diagnosis')await atomicJson(join(directory,'investigations',`company-${companyId}.request.json`),{version:1,runId,companyId,attemptsAllowed:1,outcomes,unsupportedSources,reasons:gate.state.records.find(record=>record.companyId===companyId)?.reasons??[],sourceBudgets:Object.fromEntries(companySources.map(source=>[source.database!.sourceId,checkpoint.get().sourceBudgets[source.database!.sourceId]??{reads:0,activeMs:0,engineCandidates:0}]))});await persist(false);if(targetReached||gate.action!=='continue')return
        }
        state=checkpoint.get();state.status='complete';stopReason=boundedBatch?'batch_scope_complete':successTargetPolicy?'frozen_scope_exhausted_before_success_target':undefined;state.stopReason=stopReason;await checkpoint.replace(state)
      } finally {await pageCheckpoint?.close().catch(()=>{});await context?.close().catch(()=>{});context=undefined;await release()}
    })
  } catch(error){const quota=guard.latest();stopReason=quota.status==='ready'?(error instanceof Error?error.message:String(error)):quota.reason;const state=checkpoint.get();state.status=quota.status==='hard_stopped'?'hard_stopped':'paused';await checkpoint.replace(state)}
  finally {await (deps.closeRateLimit?.()??appServer?.close()??Promise.resolve())}
  let state=checkpoint.get();const quotaState=guard.latest();if(state.status==='running'){state.status=quotaState.status==='hard_stopped'?'hard_stopped':'paused';stopReason=stopReason??(quotaState.status==='ready'?'execution_interrupted':quotaState.reason);state.stopReason=stopReason;await checkpoint.replace(state);state=checkpoint.get()}else if(stopReason!==undefined&&state.stopReason!==stopReason){state.stopReason=stopReason;await checkpoint.replace(state);state=checkpoint.get()}
  const report=await persist(state.status==='complete');console.log(JSON.stringify({runId,mode,status:state.status,reason:stopReason??null,report:join(directory,'benchmark-report.md'),quota:guard.latest().observation??null}));return report
}
