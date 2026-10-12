import { SOL_MODEL } from './infrastructure/sol-model.ts'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { digest } from '../company-client-management/legacy-snapshot.mts'
import { createRuntimeDatabase } from './infrastructure/postgres.ts'
import { createDatabaseRead } from './infrastructure/database.ts'
import { createFileStore, atomicJson, safeId, redact } from './infrastructure/store.ts'
import { createBrowserSession, parseBrowserDriver, preflightBrowser } from './infrastructure/browser.ts'
import { createAiUsageRecorder } from './infrastructure/ai-usage.ts'
import { loadDatabaseSources } from './company_sources/postgres.ts'
import { loadCampaignScope } from './stack_catalog/postgres.ts'
import { assertCampaignScope } from './stack_catalog/campaign.ts'
import { createPageReader } from './vacancy_collection/page-reader.ts'
import { openCollectionCheckpoint } from './vacancy_collection/checkpoint.ts'
import { saveCollection, loadCollection } from './vacancy_collection/postgres.ts'
import { scanCollection } from './vacancy_collection/scan.ts'
import { loadSourceMemory, saveSourceMemory, migrateSourceMemory, checkpointInvestigation } from './vacancy_collection/memory-postgres.ts'
import { loadSelectionRules } from './stack_classification/rules.ts'
import { classifyWithReuse, seedReviewedCache, semanticCacheHit } from './stack_classification/reuse.ts'
import type { CachedAssessment } from './stack_classification/reuse.ts'
import { configureCombinedAssessment } from './stack_classification/combined-ai.ts'
import { saveClassification } from './stack_classification/postgres.ts'
import { generateCollectionReport, companyCoverage } from './reporting/collection.ts'
import type { VacancyCollection } from './vacancy_collection/index.ts'
import { classifyVacancies } from './stack_classification/index.ts'
import { createReviewedAssessors } from './stack_classification/reviewed-assessor.ts'
import { createSessionReasoner } from './vacancy_collection/session-reasoner.ts'
import { createTitlePrecheck, titlePrecheckMetadata } from './vacancy_collection/title-precheck.ts'
import { createAssessmentPrecheck } from './stack_classification/precheck.ts'
import { writeAssessmentHandoff } from './stack_classification/assessment-handoff.ts'
import { openScanBudget } from './infrastructure/scan-budget.ts'
import { classifyWithSessionBatches, validateSessionPolicy, withSessionClassificationLock, sessionPolicyKey } from './stack_classification/session-classification.ts'
import { createCodexClassificationTransport } from './stack_classification/classification-runner.ts'
import { classificationUsage } from './reporting/classification-metrics.ts'
import { resolveScanExchangeRates } from './infrastructure/exchange-rates.ts'

/** Composition only. Stages remain independently callable; scan never imports application execution. */
export async function scanCommand(command:string,args:string[]) {
  const flag=(name:string)=>args.includes('--'+name)
  const arg=(name:string,fallback?:string)=>{const i=args.indexOf('--'+name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw Error('missing_flag_value:'+name);return args[i+1]}
  const ids=(name:string)=>arg(name)?.split(',').map(x=>x.trim())
  const db=createRuntimeDatabase()
  let checkpoint:Awaited<ReturnType<typeof openCollectionCheckpoint>>|undefined, release:(()=>Promise<void>)|undefined, browser:Awaited<ReturnType<typeof createBrowserSession>>|undefined, browserTask:ReturnType<typeof createBrowserSession>|undefined
  let budget:Awaited<ReturnType<typeof openScanBudget>>|undefined
  try {
    if(command==='scan-schema') {
      if(flag('apply')&&!arg('expect-checksum'))throw Error('reviewed_checksum_required')
      const plan=await migrateSourceMemory(db,flag('apply')?arg('expect-checksum'):undefined)
      if(arg('out'))await atomicJson(resolve(arg('out')!),plan)
      console.log(JSON.stringify(plan));return
    }
    if(command==='scan-report') {
      const runIds=ids('runs');if(!runIds?.length)throw Error('run_ids_required')
      const rows=[]
      for(const id of runIds){const saved=await loadCollection(safeId(id),db.read);if(!saved.classification)throw Error('saved_classification_required');rows.push(saved.classification)}
      const out=resolve(arg('out','logs/external-responses/scan-comparison.md')!)
      await mkdir(resolve(out,'..'),{recursive:true})
      const lines=['# Collection verification comparison','','| Run | Companies complete / selected | Sources fresh/replayed/reused/paused | Reader calls | Repairs | Sol proposals | Cache hits | Pending | Accepted | API assessment calls |','|---|---|---|---:|---:|---:|---:|---:|---:|---:|',...rows.map(c=>{
        const trace=c.collection.audit.map(a=>a.trace),e=c.evaluation,accepted=new Set(Object.values(c.groups).flatMap(g=>g.matchedIds)).size
        const companies=companyCoverage(c.collection),complete=companies.filter(c=>c.status==='complete').length
        return `| ${c.collection.runId} | ${complete}/${companies.length} | ${['fresh','replay','reused','paused'].map(mode=>trace.filter(t=>t?.mode===mode).length).join('/')} | ${trace.reduce((n,t)=>n+(t?.requests??0),0)} | ${trace.filter(t=>t?.repaired).length} | ${trace.reduce((n,t)=>n+(t?.actions.filter(a=>a.operation==='proposal_loaded').length??0),0)} | ${e?.hits??0} | ${e?.pendingIds.length??0} | ${accepted} | ${e?.calls??0} |`
      }),'','Reader calls count reader operations, not browser asset requests. Companies without supported sources remain in the denominator. A company is complete only when its selected sources are complete and it has no source-coverage issue. Reused decisions preserve their original API/human/session provenance. Codex usage is separate from API usage; session tokens are unavailable. No applications are part of scan.','',...rows.map(c=>generateCollectionReport(c).markdown)]
      await writeFile(out,lines.join('\n'));console.log('Report: '+out);return
    }
    if(flag('offline')||flag('live'))throw Error('scan_is_sql_collection_only')
    const companyIds=ids('company-ids')
    if(!!companyIds===flag('all-companies'))throw Error('select_company_ids_or_all_companies')
    const runId=safeId(arg('run',`scan-${Date.now()}`)!),driver=parseBrowserDriver(arg('browser-driver')),maxPages=Number(arg('max-pages','24'))
    const concurrency=Number(arg('concurrency','3'))
    const maxSourceMs=Number(arg('source-timeout-seconds','300'))*1000
    if(!Number.isInteger(maxSourceMs)||maxSourceMs<1000||maxSourceMs>1800000)throw Error('invalid_source_time_budget')
    if(!Number.isInteger(concurrency)||concurrency<1||concurrency>3)throw Error('invalid_collection_concurrency')
    if(!Number.isInteger(maxPages)||maxPages<1||maxPages>200)throw Error('invalid_page_budget')
    if(arg('budget-campaign')) {
      if(concurrency!==1||arg('classification','cached')!=='cached')throw Error('guarded_scan_requires_sequential_cached_classification')
      budget=await openScanBudget(resolve(arg('budget-campaign')!),async()=>{const owned=browser??await browserTask;await owned?.close()})
    }
    const root=resolve(arg('storage','storage/external-responses')!),directory=resolve(arg('logs','logs/external-responses')!,'scans',runId)
    release=await createFileStore(resolve('storage/external-responses')).lock('shared-vacancy-collection')
    const catalog=await loadDatabaseSources(createDatabaseRead(),{companyIds}),scope=await loadCampaignScope({stackIds:ids('db-stacks'),studentIds:ids('students')},{read:createDatabaseRead()})
    assertCampaignScope(scope)
    let saved:Awaited<ReturnType<typeof loadCollection>>|undefined
    try {saved=await loadCollection(runId,db.read)}catch(error:any){if(error.code!=='collection_run_not_found')throw error}
    if(saved&&!flag('resume'))throw Error('scan_run_exists_use_resume')
    if(flag('resume')&&!saved)throw Error('scan_run_missing')
    const memories=await loadSourceMemory(catalog.sources,db.read),rules=await loadSelectionRules(arg('selection-rules')),titlePrecheck=createTitlePrecheck(rules,scope)
    const fx=await resolveScanExchangeRates({runDirectory:directory,cachePath:join(root,'exchange-rates.daily.json'),resume:flag('resume'),manual:arg('exchange-rates')?JSON.parse(await readFile(arg('exchange-rates')!,'utf8')):undefined},{signal:budget?.signal})
    const exchangeRates=fx.rates
    const mode=arg('classification','cached')
    const sessionPolicy=arg('classification-session-policy')?JSON.parse(await readFile(arg('classification-session-policy')!,'utf8')):undefined
    if(sessionPolicy){validateSessionPolicy(sessionPolicy);if(mode!=='cached'||concurrency!==1||!budget||arg('assessments'))throw Error('session_classification_requires_cached_sequential_budget_and_no_manual_review')}
    const reasonerMode=arg('reasoner','none')
    if(!['none','codex'].includes(reasonerMode!))throw Error('collection_reasoner_not_available: use none or codex; API repair remains disabled')
    if(reasonerMode==='codex'&&(concurrency!==1||mode==='api'))throw Error('codex_collection_requires_sequential_no_paid_api')
    if(!['cached','api'].includes(mode!))throw Error('unknown_classification_mode')
    preflightBrowser(driver)
    await mkdir(directory,{recursive:true})
    const event=async(data:unknown)=>appendFileSync(join(directory,'events.jsonl'),JSON.stringify(redact({at:new Date().toISOString(),runId,...data as object}))+'\n',{mode:0o600})
    await event({action:flag('resume')?'scan_resuming':'scan_started',driver,companyIds:catalog.companyIds,maxPages,maxSourceMs,concurrency})
    await event({action:'exchange_rates',mode:fx.mode,asOf:exchangeRates?.asOf,source:exchangeRates?.source,...('reason' in fx?{reason:fx.reason}:{})})
    const usage=createAiUsageRecorder(line=>appendFileSync(join(directory,'events.jsonl'),line+'\n',{mode:0o600}))
    const inference=configureCombinedAssessment({requested:mode==='api'&&!flag('no-ai'),policy:arg('inference-policy')?JSON.parse(await readFile(arg('inference-policy')!,'utf8')):undefined,env:process.env,usage})
    const {assess,reason:pendingReason}=inference
    const policy=sessionPolicy?sessionPolicyKey(sessionPolicy,exchangeRates):inference.policyKey
    const cache:Record<string,CachedAssessment>={},fallbackCache:Record<string,CachedAssessment>={},hints=new Map<string,string[]>()
    for(const memory of memories.values())Object.assign(cache,memory.state.decisions)
    if(arg('seed-run')) {
      const seed=await loadCollection(safeId(arg('seed-run')!),db.read)
      if(!seed.classification)throw Error('reviewed_seed_classification_required')
      Object.assign(fallbackCache,seedReviewedCache(seed.classification,rules,scope.stacks))
      for(const source of seed.collection.sources)if(source.database&&source.listingUrls?.length&&catalog.sources.some(s=>s.database?.sourceId===source.database!.sourceId&&s.url===source.url))hints.set(source.database.sourceId,source.listingUrls)
    }
    const {capturedAt:_capture,digest:_scopeHash,...scopeConfig}=scope
    const configHash=digest({sources:catalog.sources,companies:catalog.companyIds,scope:scopeConfig,maxPages,...(maxSourceMs!==300000?{maxSourceMs}:{}),driver,force:flag('force-refresh'),retryReviews:flag('retry-reviews'),rules:rules.sha256,policy,exchangeRates,seed:arg('seed-run'),...(concurrency!==3?{concurrency}:{}),...(reasonerMode!=='none'?{reasonerMode}:{}),...(budget?{budgetPolicy:budget.policyHash}:{})})
    if(saved?.collection.scan?.configHash&&saved.collection.scan.configHash!==configHash)throw Error('scan_resume_scope_or_policy_changed')
    const startedAt=saved?.collection.scan?.startedAt??new Date().toISOString()
    let collection=saved?.collection.scan?.status==='complete'?saved.collection:undefined
    if(!collection) {
      checkpoint=await openCollectionCheckpoint({directory:join(root,'collections',runId),resume:flag('resume'),identity:{runId,configHash}})
      if(checkpoint.completed) collection=checkpoint.completed
      else {
        const initial:VacancyCollection={version:1,runId,sources:catalog.sources,scope,titlePrecheck:titlePrecheckMetadata(titlePrecheck),positions:saved?.collection.positions??[],audit:saved?.collection.audit??[],createdAt:saved?.collection.createdAt??startedAt,sourceIssues:catalog.issues,deferredSources:catalog.deferred,scan:{status:'running',configHash,companies:catalog.companies,startedAt}}
        let latest=initial
        await budget?.admit()
        await saveCollection(initial,db.write)
        const reader=checkpoint.reader({read:async(url,options)=>{
          await budget?.admit()
          try {
          browserTask??=createBrowserSession({profilePath:join(root,'candidates','collection','browser'),driver,headless:flag('headless'),onSession:info=>event({action:'browser_session',...info})})
          browser=await browserTask
          pageReader??=createPageReader({context:browser,evidenceDirectory:join(directory,'evidence'),excludedHosts:['himalayas.app','hiringcafe.com','wantapply.com','hirefy.com','hirify.me']})
          const page=await pageReader.read(url,options)
          await budget?.admit();return page
          }catch(error){await budget?.admit();throw error}
        }})
        let pageReader:ReturnType<typeof createPageReader>|undefined
        try {
          const collected=await scanCollection({runId,sources:catalog.sources,scope,titlePrecheck,force:flag('force-refresh'),maxPages,maxSourceMs,memories,hints,retryReviews:flag('retry-reviews'),concurrency,previousAttempt:saved?.collection},{reader,reasoner:reasonerMode==='codex'?createSessionReasoner(join(directory,'investigations')):undefined,loadRun:async id=>(await loadCollection(id,db.read)).collection,action:async(source,action)=>{
            await event({sourceId:source.database!.sourceId,...action})
            if(action.operation==='investigation_requested')await checkpointInvestigation({sourceId:source.database!.sourceId,runId,requestId:action.detail!,memory:memories.get(source.database!.sourceId)!},db.write)
          },onProgress:async result=>{
            const completed=new Set(result.audit.map(a=>a.source.database!.sourceId))
            const prior=initial.positions.filter(p=>(p.sources??[p.source]).every(s=>!completed.has(s.database!.sourceId)))
            latest={...initial,positions:[...prior,...result.positions],audit:[...initial.audit.filter(a=>!completed.has(a.source.database!.sourceId)),...result.audit]}
            await saveCollection(latest,db.write)
          },onAttempt:async source=>{
            await budget?.admit()
            await db.write(s=>s.query('UPDATE noco.sources SET last_search_attempt_at=now() WHERE id=$1',[source.database!.sourceId]));await event({action:'source_started',sourceId:source.database!.sourceId})
          }})
          const pending=collected.audit.some(a=>a.trace?.investigation?.status==='pending')
          collection={...collected,sourceIssues:catalog.issues,deferredSources:catalog.deferred,scan:{status:pending?'interrupted':'complete',configHash,companies:catalog.companies,startedAt,finishedAt:new Date().toISOString()}}
          if(!pending)await checkpoint.complete(collection)
        } catch(error:any) {
          const records=(await readFile(join(directory,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
          const audits=[...latest.audit]
          for(const audit of error.partial?.audit??[]){const i=audits.findIndex(a=>a.source.database!.sourceId===audit.source.database!.sourceId);if(i<0)audits.push(audit);else audits[i]=audit}
          for(const source of catalog.sources)if(!audits.some((a:any)=>a.source.database?.sourceId===source.database!.sourceId))audits.push({source,status:'unavailable',terminal:false,pages:[],found:0,issues:['Scan interrupted'],trace:{mode:'fresh',startedAt,finishedAt:new Date().toISOString(),requests:0,actions:records.filter(r=>r.sourceId===source.database!.sourceId&&r.operation)}})
          await saveCollection({...latest,audit:audits,scan:{...initial.scan!,status:'interrupted',finishedAt:new Date().toISOString()}},db.write)
          await event({action:'scan_interrupted',reason:error.message});throw error
        }
      }
      await saveCollection(collection!,db.write)
    }
    if(collection!.scan?.status!=='complete') {
      const requests=collection!.audit.filter(a=>a.trace?.investigation?.status==='pending').map(a=>({sourceId:a.source.database!.sourceId,company:a.source.name,requestId:a.trace!.investigation!.request.id}))
      await event({action:'awaiting_codex_investigation',requests,model:SOL_MODEL,paidApiCalls:0})
      console.log(JSON.stringify({runId,awaitingInvestigation:true,requests,directory:join(directory,'investigations')}));return
    }
    await budget?.admit()
    if(flag('await-review')&&!saved?.classification&&!arg('assessments')&&!sessionPolicy) {
      const precheck=createAssessmentPrecheck(rules,scope,undefined,exchangeRates)
      const semantic=collection!.positions.filter(position=>!precheck(position))
      const missing=new Set(semantic.filter(position=>!semanticCacheHit(position,scope.stacks,rules,policy,[cache[position.id],fallbackCache[position.id]],exchangeRates)).map(position=>position.id))
      if(missing.size) {
        // Collection recipes/freshness do not depend on semantic assessment completion.
        await saveSourceMemory({runId,audits:collection!.audit,memories,decisions:{},positionSources:new Map(),collectionOnly:true},db.write)
        const packets=await writeAssessmentHandoff(join(directory,'assessments'),collection!,rules,missing,exchangeRates)
        await event({action:'awaiting_explicit_review',postings:missing.size,packets})
        console.log(JSON.stringify({runId,awaitingReview:true,postings:missing.size,cached:semantic.length-missing.size,automatic:collection!.positions.length-semantic.length,packets,collectionDigest:digest(collection),rulesHash:rules.sha256}));return
      }
    }
    const review=arg('assessments')?JSON.parse(await readFile(arg('assessments')!,'utf8')):undefined
    if(review&&saved?.classification&&saved.classification.assessmentProvenance?.reviewHash!==digest(review))throw Error('saved_review_changed')
    let assessment
    if(saved?.classification)assessment=await classifyWithReuse({collection:collection!,rules,cache,fallbackCache,policy,exchangeRates})
    else if(sessionPolicy) {
      assessment=await withSessionClassificationLock(join(directory,'session-classification'),runId,store=>classifyWithSessionBatches({collection:collection!,rules,cache,fallbackCache,policy:sessionPolicy,exchangeRates},{store,transport:createCodexClassificationTransport({onProbe:proof=>event({action:'classification_transport_preflight',...proof})}),signal:budget!.signal,admit:()=>budget!.admit()}))
      await atomicJson(join(directory,'classification-usage.json'),classificationUsage(assessment.batches.responses))
      await event({action:'session_classification',completedBatches:assessment.batches.completed.length,reusedBatches:assessment.batches.reused,pending:assessment.packetPending})
    } else if(review) {
      const adapter=createReviewedAssessors(review,collection!,rules,new Date(),exchangeRates)
      assessment=await classifyWithReuse({collection:collection!,rules,cache,fallbackCache,policy,exchangeRates,assessmentProvenance:adapter.provenance},{assess:async position=>review.decisions[position.id]})
      await event({action:'explicit_review',origin:review.origin,reviewHash:adapter.provenance.reviewHash,postings:collection!.positions.length})
    } else assessment=await classifyWithReuse({collection:collection!,rules,cache,fallbackCache,policy,exchangeRates},{assess,onDecision:(id,outcome)=>event({action:'classification',positionId:id,outcome})})
    const classified=assessment.classified
    if(!saved?.classification)await saveClassification(classified,db.write)
    const positionSources=new Map(collection!.positions.map(p=>[p.id,(p.sources??[p.source]).map(s=>s.database!.sourceId)]))
    await saveSourceMemory({runId,audits:collection!.audit,memories,decisions:assessment.updates,positionSources},db.write)
    const report=generateCollectionReport(classified),out=resolve(arg('out',join(directory,'report.md'))!)
    await mkdir(resolve(out,'..'),{recursive:true})
    const metrics=usage.report()
    const classificationConfiguration=sessionPolicy?'Approved Codex session classifier (Sol medium); no separate paid API':pendingReason||'approved API enabled'
    const fxStatus=exchangeRates?`${exchangeRates.asOf}, ${exchangeRates.source} (${fx.mode})`:`unavailable (${fx.mode}); non-USD salary needing conversion remains pending`
    await writeFile(out,report.markdown+`\nClassification configuration: ${classificationConfiguration}.\nExchange-rate evidence: ${fxStatus}.\nMeasured separate API calls: ${metrics.logicalCalls}; known input/output tokens: ${metrics.knownInputTokens}/${metrics.knownOutputTokens}; unknown usage attempts: ${metrics.unknownUsageAttempts}.\n`)
    if(flag('export')){await atomicJson(join(directory,'classified.json'),classified);await writeFile(join(directory,'companies.csv'),report.csv);await writeFile(join(directory,'accepted-vacancies.csv'),report.vacancyCsv)}
    await event({action:'scan_completed',accepted:report.vacancies.length,pending:classified.evaluation?.pendingIds.length??0,cacheHits:classified.evaluation?.hits??0})
    console.log(JSON.stringify({runId,companies:catalog.companyIds.length,postings:collection!.positions.length,accepted:report.vacancies.length,pending:classified.evaluation?.pendingIds.length??0,cacheHits:classified.evaluation?.hits??0,report:out}))
  } finally {
    try { await browser?.close() }
    finally { try { await budget?.close() } finally { try { await checkpoint?.close() } finally { try { await release?.() } finally { await db.close() } } } }
  }
}
