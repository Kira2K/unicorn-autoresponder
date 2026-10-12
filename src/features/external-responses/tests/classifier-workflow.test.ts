import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { collectVacancies } from '../vacancy_collection/index.ts'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { loadSelectionRules, assertCurrentSelectionRules } from '../stack_classification/rules.ts'
import { classificationInstructions } from '../stack_classification/assessment-batches.ts'
import { classifyWithSessionBatches, createAssessmentStore, validateSessionPolicy, withSessionClassificationLock, sessionPolicyKey } from '../stack_classification/session-classification.ts'
import { createCodexClassificationTransport } from '../stack_classification/classification-runner.ts'
import { generateCollectionReport } from '../reporting/collection.ts'
import { classificationUsage } from '../reporting/classification-metrics.ts'
import { decisionKey } from '../stack_classification/reuse.ts'
import { revalidateSession } from '../stack_classification/revalidate-session.ts'
import { workflowFixture } from '../../company-client-management/tests/runtime-fixture.mts'
import { createReadSession } from '../../../integrations/postgres/read-session.mts'
import { writeTransaction } from '../../../integrations/postgres/working-session.mts'
import { loadDatabaseSources } from '../company_sources/postgres.ts'
import { saveCollection } from '../vacancy_collection/postgres.ts'
import { saveClassification } from '../stack_classification/postgres.ts'
import type { Source } from '../types.ts'

function policy(){const content={version:1 as const,model:'gpt-6-sol' as const,effort:'medium' as const,promptHash:digest(classificationInstructions),initialBytes:65536,expandedBytes:131072,maxOutputTokens:8192,outputLimitMode:'observed' as const,maxBatches:10,retries:0 as const,tools:'none' as const,approvedBy:'fixture',approvedAt:'2026-09-30T00:00:00Z',approvalReference:'offline mock only'};return {...content,sha256:digest(content)}}
test('new model requires its own policy binding; historical policy cannot dispatch silently',()=>{
  validateSessionPolicy(policy())
  const {sha256,...content}=policy()
  const historical={...content,model:'gpt-5.6-sol'}
  assert.throws(()=>validateSessionPolicy({...historical,sha256:digest(historical)} as any),/approved_session_classification_policy_required/)
})
async function fixture(source:Source={name:'Example',url:'https://example.test/careers',database:{companyId:'1',sourceId:'1',applicationRoute:'standard_workflow' as const}},database='fixture'){
  const scope=buildCampaignScope({database:database as any,stacks:[{id:'2',name:'Python',description:'Python backend; not Django-heavy or QA.'},{id:'5',name:'Java',description:'Java backend, Spring or no framework.'},{id:'7',name:'Go',description:'Go backend.'}],students:[{studentId:'1',stackId:'2'},{studentId:'2',stackId:'5'},{studentId:'3',stackId:'7'}]})
  const roles=[['Senior Python Engineer','Worldwide'],['Middle Java Developer','London, GB'],['Senior Golang Engineer','Tbilisi, GE'],['Python Developer','Remote'],['Customer Support','Worldwide'],['Staff Python Engineer','Worldwide']]
  const positions=roles.map(([title,location],i)=>({id:String(i),company:source.name,title,location,description:'Build production backend services and APIs. Own deployment, observability and developer tests. Work closely with engineers on database performance and delivery.',url:source.url+'/role-'+i,applyUrl:source.url+'/role-'+i,retrievedAt:new Date().toISOString(),source}))
  return collectVacancies({runId:'classifier-workflow',sources:[source],scope},{strategy:{name:'fixture',discover:async()=>({positions,audit:[{source,status:'complete',found:positions.length,pages:[source.url],issues:[]}]})}})
}
function mockTransport(onCall=()=>{}) {
  return {
    preflight:async()=>({toolExecution:'disabled' as const,structuredOutput:true}),
    generate:async(b:any)=>{
      onCall()
      const decisions=b.payload.vacancies.map((p:any)=>{
        const d={decision:p.vacancy.location==='Remote'?'review':'eligible',reasons:['Fixture response; tests composition, not model accuracy'],evidence:['Build production backend services and APIs.']}
        return {positionId:p.positionId,inputHash:p.inputHash,global:d,stacks:Object.fromEntries(p.candidateStackIds.map((s:string)=>[s,d]))}
      })
      return {toolCalls:0,responseId:b.id,usage:{inputTokens:100,cachedInputTokens:20,outputTokens:40,reasoningTokens:10},value:{batchId:b.id,decisions}}
    },
  }
}

test('recorded FX and deterministic salary result reach the model and bind cache/resume',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'classifier-fx-'))
  try {
    const collection=await fixture();collection.positions=collection.positions.slice(0,1)
    collection.positions[0].description+='\nWe offer a salary of up to €6,600 gross per month.'
    const rates={asOf:'2026-10-02',source:'https://fixture.test/rates',usdPerUnit:{EUR:1.1225}}
    const input={collection,rules:await loadSelectionRules(),cache:{},policy:policy(),exchangeRates:rates}
    const store=createAssessmentStore(directory),base=mockTransport();let calls=0
    const transport={...base,generate:async(b:any)=>{
      calls++;const vacancy=b.payload.vacancies[0].vacancy
      assert.deepEqual(vacancy.exchangeRates,rates);assert.equal(vacancy.salaryCheck.status,'pass')
      assert.equal(vacancy.salaryCheck.normalized.max,7408.5)
      assert.equal(vacancy.salaryCheck.normalized.evidence.rateSource,rates.source)
      return base.generate(b)
    }}
    const first=await classifyWithSessionBatches(input,{transport,store,admit:async()=>{}})
    assert.equal(first.classified.groups['stack-2'].matchedIds.length,1)
    assert.equal(sessionPolicyKey(input.policy,rates),sessionPolicyKey(input.policy))
    assert.notEqual(sessionPolicyKey(input.policy),'session-batch-v1:'+input.policy.sha256)
    await classifyWithSessionBatches({...input,cache:first.updates},{transport,store,admit:async()=>{throw Error('cache should avoid dispatch')}})
    assert.equal(calls,1)
  }finally{await rm(directory,{recursive:true,force:true})}
})

test('daily FX changes and unavailable rates do not redispatch a posting without stated salary',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'classifier-no-pay-'))
  try{
    const collection=await fixture();collection.positions=collection.positions.slice(0,1)
    const input={collection,rules:await loadSelectionRules(),cache:{},policy:policy(),exchangeRates:{asOf:'2026-10-02',source:'fixture',usdPerUnit:{EUR:1.12}}}
    let calls=0;const base=mockTransport(),store=createAssessmentStore(directory),transport={...base,generate:async(b:any)=>{calls++;assert.equal(b.payload.vacancies[0].vacancy.exchangeRates,undefined);return base.generate(b)}}
    const first=await classifyWithSessionBatches(input,{transport,store,admit:async()=>{}})
    for(const exchangeRates of [undefined,{...input.exchangeRates,asOf:'2026-10-03',usdPerUnit:{EUR:1.13}}]){
      const result=await classifyWithSessionBatches({...input,exchangeRates,cache:first.updates},{transport,store,admit:async()=>{throw Error('unchanged posting must reuse')}})
      assert.equal(result.classified.evaluation?.hits,1)
    }
    assert.equal(calls,1)
  }finally{await rm(directory,{recursive:true,force:true})}
})

test('whole workflow batches three stacks once, excludes titles before model, saves accepted-only SQL, resumes and reuses exact cache',async()=>{
  const f=await workflowFixture(),directory=await mkdtemp(join(tmpdir(),'classifier-workflow-'))
  try{
    await f.db.exec('INSERT INTO noco.stacks VALUES(2),(7)')
    const read=createReadSession(f.pool,f.database),write=<T>(fn:any)=>writeTransaction<T>(f.pool,f.database,fn)
    const catalog=await loadDatabaseSources(fn=>read(s=>fn(s,{} as any,{} as any))), collection=await fixture(catalog.sources[0],f.database)
    const rules=await loadSelectionRules(),p=policy(),store=createAssessmentStore(directory);let calls=0
    const transport=mockTransport(()=>calls++),input={collection,rules,cache:{},policy:p}
    const first=await classifyWithSessionBatches(input,{transport,store,admit:async()=>{}})
    assert.equal(calls,1);assert.equal(first.batches.completed.length,1)
    const report=generateCollectionReport(first.classified)
    assert.deepEqual([report.totals.accepted,report.totals.review,report.totals.excluded,report.totals.unassessed],[3,1,2,0])
    assert.match(report.markdown,/1 require substantive\/data review/)
    await saveCollection(collection,write);await saveClassification(first.classified,write);await saveClassification(first.classified,write)
    const rows=(await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies')).rows[0];assert.equal(rows.n,3)
    const resumed=await classifyWithSessionBatches(input,{transport,store,admit:async()=>{}});assert.equal(resumed.batches.reused,1);assert.equal(calls,1)
    const cached=await classifyWithSessionBatches({...input,cache:first.updates},{transport:createCodexClassificationTransport(),store,admit:async()=>{throw Error('cache must not dispatch')}})
    // Bare Remote now reaches assessment; its mock semantic-review decision is also reusable.
    assert.equal(cached.classified.evaluation!.hits,4);assert.equal(calls,1)
  }finally{await f.db.close();await rm(directory,{recursive:true,force:true})}
})
test('real Codex adapter stays pending without tool-free proof; no SQL acceptance or alternative model',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'classifier-unavailable-'))
  try{const result=await classifyWithSessionBatches({collection:await fixture(),rules:await loadSelectionRules(),cache:{},policy:policy()},{transport:createCodexClassificationTransport({probe:async()=>({toolsAbsent:false,structuredOutput:true,model:'gpt-6-sol',inputBytes:0,providerOutputCap:false})}),store:createAssessmentStore(directory),admit:async()=>{}})
    assert.equal(generateCollectionReport(result.classified).totals.unassessed,4)
    assert.equal(generateCollectionReport(result.classified).vacancies.length,0)
    assert.equal(result.classified.evaluation!.calls,0);assert.equal(result.classified.evaluation!.sessionReviews??0,0)
    assert.equal(result.classified.assessmentProvenance,undefined)
    assert.ok(result.packetPending.every(p=>p.reason==='codex_classification_wire_preflight_failed'))
  }finally{await rm(directory,{recursive:true,force:true})}
})
test('missing account model leaves unresolved vacancies pending and preserves deterministic exclusions',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'missing-sol-model-'))
  try {
    const transport=createCodexClassificationTransport({probe:async()=>({toolsAbsent:true,structuredOutput:true,model:'gpt-6-sol',inputBytes:0,providerOutputCap:false}),createServer:(()=>({readModels:async()=>[],close:async()=>{}})) as any})
    const result=await classifyWithSessionBatches({collection:await fixture(),rules:await loadSelectionRules(),cache:{},policy:policy()},{transport,store:createAssessmentStore(directory),admit:async()=>{}})
    assert.equal(result.batches.completed.length,0)
    assert.ok(result.packetPending.length>0)
    assert.ok(result.packetPending.every(p=>p.reason==='sol_model_not_listed:gpt-6-sol'))
  }finally{await rm(directory,{recursive:true,force:true})}
})

test('document-only edits preserve cache and application compatibility; true rule/body changes invalidate',async()=>{
  const rules=await loadSelectionRules(),collection=await fixture(),p=collection.positions[0],stacks=collection.scope!.stacks
  const {createHash}=await import('node:crypto'),edit=(text:string)=>({...rules,text,sha256:createHash('sha256').update(text).digest('hex')})
  const docs=edit(rules.text.replace('# Shared vacancy selection','# Shared vacancy selection documentation'))
  assertCurrentSelectionRules(rules,docs);assert.equal(decisionKey(p,stacks,rules,'policy'),decisionKey(p,stacks,docs,'policy'))
  const changed=edit(rules.text.replace('3,000','4,000'))
  assert.throws(()=>assertCurrentSelectionRules(rules,changed));assert.notEqual(decisionKey(p,stacks,rules,'policy'),decisionKey(p,stacks,changed,'policy'))
  assert.notEqual(decisionKey(p,stacks,rules,'policy'),decisionKey({...p,description:p.description+' Must reside in US.'},stacks,rules,'policy'))
  const missing=policy();missing.approvedBy='';assert.throws(()=>validateSessionPolicy(missing))
})
test('whole-run file lock rejects another owner; usage deduplicates final responses and keeps unknown visible',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'classifier-lock-'))
  try{await withSessionClassificationLock(directory,'same',async()=>{await assert.rejects(withSessionClassificationLock(directory,'same',async()=>{}),/lock exists/)})}finally{await rm(directory,{recursive:true,force:true})}
  const known={batchId:'a',response:{value:{},toolCalls:0,responseId:'r',usage:{inputTokens:100,cachedInputTokens:70,outputTokens:20,reasoningTokens:5}}}
  const result=classificationUsage([known,known,{batchId:'b',response:{value:{},toolCalls:0}}])
  assert.deepEqual(result,{responses:2,duplicates:1,unknown:1,inputTokens:100,cachedInputTokens:70,uncachedInputTokens:30,outputTokens:20,reasoningTokens:5,coordinatorTokens:null})
})

test('revalidation is offline, preserves observation times and refuses changed rules or stacks',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'classifier-recovery-'))
  try {
    const collection=await fixture(),rules=await loadSelectionRules(),p=policy(),store=createAssessmentStore(directory)
    const first=await classifyWithSessionBatches({collection,rules,cache:{},policy:p},{store,transport:mockTransport(),admit:async()=>{}})
    const args={saved:first.classified,rules,stacks:collection.scope!.stacks,policy:p,store,runId:'recovered',revalidationAt:'2026-09-30T08:00:00Z'}
    const recovered=await revalidateSession(args),again=await revalidateSession(args)
    assert.equal(recovered.recovery.newAiCalls,0);assert.equal(recovered.recovery.reusedBatches,1)
    assert.equal(recovered.classified.digest,again.classified.digest)
    assert.equal(recovered.classified.collection.positions[0].retrievedAt,collection.positions[0].retrievedAt)
    assert.deepEqual(recovered.classified.groups,first.classified.groups)
    await assert.rejects(revalidateSession({...args,stacks:args.stacks.map(s=>({...s,description:s.description+' changed'}))}),/scope_or_rules/)
    await assert.rejects(revalidateSession({...args,runId:collection.runId}),/scope_or_rules/)
  }finally{await rm(directory,{recursive:true,force:true})}
})
