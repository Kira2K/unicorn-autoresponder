import test from 'node:test'
import assert from 'node:assert/strict'
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { guardedBenchmarkCommand } from '../benchmark/command.ts'
import { emptyCompanyFailureGate, recordCompanySuccessTargetOutcome } from '../benchmark/company-failure-gate.ts'

const fixtureCampaign=resolve('logs/external-responses/guarded-benchmark-20260929'),followupFixtureCampaign=resolve('logs/external-responses/sol-four-companies-20260929'),successFixtureCampaign=resolve('logs/external-responses/sol-three-successes-20260930'),now=Date.parse('2026-09-29T17:00:00.000Z')
async function isolatedCampaign(storage:string,source=fixtureCampaign,files=['frozen-scope.json','transfer-scope.json','execution-policy.json','budget.json','cancellation-preflight.json']) {
  const campaign=join(storage,'fixture-campaign');await mkdir(campaign)
  for(const file of files)await copyFile(join(source,file),join(campaign,file))
  return campaign
}
const quota=(usedPercent=5)=>({rateLimitsByLimitId:{codex:{weekly:{windowDurationMins:10080,usedPercent,resetsAt:1791292390}}}})
const job=(url:string)=>({title:'Senior Python Engineer',company:'Fixture',location:'Worldwide remote',description:'Build reliable production Python backend services and APIs with PostgreSQL. Own delivery and write developer tests.',url:url+'/jobs/one',applyUrl:url+'/jobs/one'})
const baseDeps=(read:(url:string)=>Promise<any>,usedPercent=5)=>({now:()=>now,readRateLimit:async()=>quota(usedPercent),closeRateLimit:async()=>{},acquireCollectionLock:async()=>async()=>{},createBrowser:async()=>({close:async()=>{}}),createReader:()=>({read})})

test('explicit follow-up accepts the four approved companies in requested order',async()=>{
  const storage=await mkdtemp(join(tmpdir(),'guarded-followup-')),campaign=await isolatedCampaign(storage,followupFixtureCampaign,['frozen-scope.json','execution-policy.json','budget.json'])
  try {
    const result:any=await guardedBenchmarkCommand(['--mode','cold','--campaign',campaign,'--run','four-companies','--storage',storage,'--company-ids','142,143,144,145'])
    assert.deepEqual(result.companyIds,['142','143','144','145']);assert.deepEqual(result.stackIds,['2','5','7'])
  } finally {await rm(storage,{recursive:true,force:true})}
})

test('explicit follow-up rejects a source outside the approved frozen scope',async()=>{
  const storage=await mkdtemp(join(tmpdir(),'guarded-followup-leak-')),campaign=await isolatedCampaign(storage,followupFixtureCampaign,['frozen-scope.json','execution-policy.json','budget.json'])
  try {
    const path=join(campaign,'frozen-scope.json'),frozen=JSON.parse(await readFile(path,'utf8'));frozen.catalog.sources[0].database.companyId='146';await writeFile(path,JSON.stringify(frozen),'utf8')
    await assert.rejects(guardedBenchmarkCommand(['--mode','cold','--campaign',campaign,'--run','source-leak','--storage',storage]),/benchmark_frozen_scope_leakage/)
  } finally {await rm(storage,{recursive:true,force:true})}
})

test('explicit follow-up rejects budget thresholds not derived from its authorized allowance',async()=>{
  const storage=await mkdtemp(join(tmpdir(),'guarded-followup-budget-')),campaign=await isolatedCampaign(storage,followupFixtureCampaign,['frozen-scope.json','execution-policy.json','budget.json'])
  try {
    const path=join(campaign,'budget.json'),budget=JSON.parse(await readFile(path,'utf8'));budget.pauseAtPercent=10;await writeFile(path,JSON.stringify(budget),'utf8')
    await assert.rejects(guardedBenchmarkCommand(['--mode','cold','--campaign',campaign,'--run','invalid-budget','--storage',storage]),/budget_policy_threshold_mismatch/)
  } finally {await rm(storage,{recursive:true,force:true})}
})

test('success-target follow-up continues after two failures and stops before reading a sixth company',async()=>{
  const storage=await mkdtemp(join(tmpdir(),'guarded-success-target-')),campaign=await isolatedCampaign(storage,successFixtureCampaign,['frozen-scope.json','execution-policy.json','budget.json','cancellation-preflight.json']),seen:string[]=[]
  const common=['--mode','cold','--campaign',campaign,'--run','three-successes','--storage',storage,'--execute','--headless']
  try {
    const result:any=await guardedBenchmarkCommand(common,baseDeps(async url=>{seen.push(url);if(/betby\.com|betssongroup\.com/.test(url))throw Error('synthetic_company_failure');return {url,text:'No current positions',links:[],jobs:[],explicitlyEmpty:true}},8))
    assert.equal(result.status,'complete');assert.equal(result.stopReason,'successful_company_target_reached');assert.equal(result.successfulCompanyCount,3);assert.deepEqual(result.successfulCompanyIds,['148','149','150'])
    assert.deepEqual(result.companies.filter((row:any)=>row.status!=='unattempted').map((row:any)=>row.companyId),['146','147','148','149','150']);assert.equal(result.companies.find((row:any)=>row.companyId==='151').status,'unattempted');assert.equal(seen.some(url=>url.includes('borzodelivery.com')),false)
    const checkpoint=JSON.parse(await readFile(join(storage,'three-successes','benchmark-checkpoint.json'),'utf8'));assert.deepEqual(checkpoint.completedCompanyIds,['146','147','148','149','150']);assert.equal(checkpoint.successfulCompanyCount,3);assert.equal(checkpoint.stopReason,'successful_company_target_reached')
    let browsers=0,reads=0
    const resumed:any=await guardedBenchmarkCommand([...common,'--resume'],{...baseDeps(async()=>{reads++;throw Error('resume_must_not_read')},8),createBrowser:async()=>{browsers++;return {close:async()=>{}}}})
    assert.equal(resumed.successfulCompanyCount,3);assert.equal(reads,0);assert.equal(browsers,0)
  } finally {await rm(storage,{recursive:true,force:true})}
})

test('success-target coverage rejects unsupported-only and partial companies but accepts complete repaired official coverage',()=>{
  let state=emptyCompanyFailureGate()
  const unsupported=recordCompanySuccessTargetOutcome(state,{companyId:'146',sources:[],unsupportedSources:1});state=unsupported.state
  const partial=recordCompanySuccessTargetOutcome(state,{companyId:'147',sources:[{sourceId:'78',status:'partial',terminal:true}],unsupportedSources:0});state=partial.state
  const repaired=recordCompanySuccessTargetOutcome(state,{companyId:'148',sources:[{sourceId:'80',status:'complete',terminal:true,repairAttempted:true,repairSucceeded:true}],unsupportedSources:1})
  assert.equal(unsupported.successful,false);assert.equal(partial.successful,false);assert.equal(repaired.successful,true);assert.equal(repaired.state.hardStopped,false);assert.equal(repaired.state.records.some(record=>record.diagnosis?.status==='pending'),false)
})

test('legacy campaign keeps its exact twenty-company cold scope',async()=>{
  const storage=await mkdtemp(join(tmpdir(),'guarded-legacy-scope-')),campaign=await isolatedCampaign(storage)
  try {
    const result:any=await guardedBenchmarkCommand(['--mode','cold','--campaign',campaign,'--run','legacy-scope','--storage',storage,'--company-ids',Array.from({length:20},(_,i)=>String(140+i)).join(',')]);assert.deepEqual(result.companyIds,Array.from({length:20},(_,i)=>String(140+i)))
    await assert.rejects(guardedBenchmarkCommand(['--mode','cold','--campaign',campaign,'--run','legacy-narrowed','--storage',storage,'--company-ids','142,143,144,145']),/cold_benchmark_requires_original_twenty_companies/)
  } finally {await rm(storage,{recursive:true,force:true})}
})

test('live cold runner checkpoints partial evidence, pauses twice for diagnosis, then hard-stops the third failed company without duplicate reads',async()=>{
  const storage=await mkdtemp(join(tmpdir(),'guarded-cold-')),campaign=await isolatedCampaign(storage),reads=new Map<string,number>()
  const reader=async(url:string)=>{reads.set(url,(reads.get(url)??0)+1);if(url.includes('bayt.com'))return {url,text:'Senior Python Engineer',links:[],jobs:[job(url)],partial:true};throw Error('synthetic_third_company_transport_failure')}
  const common=['--mode','cold','--campaign',campaign,'--run','cold-live','--storage',storage,'--execute','--headless']
  try {
    const first:any=await guardedBenchmarkCommand(common,baseDeps(reader));assert.equal(first.status,'paused');assert.equal(first.failureStreak,1);assert.equal(first.companies.length,20)
    const requests=await readdir(join(storage,'cold-live','investigations'));assert.ok(requests.some(name=>name.endsWith('.request.json')))
    const second:any=await guardedBenchmarkCommand([...common,'--resume','--diagnose-company','140'],baseDeps(reader));assert.equal(second.status,'paused');assert.equal(second.failureStreak,2);assert.equal(second.companies.find((row:any)=>row.companyId==='141').unsupported,1)
    const third:any=await guardedBenchmarkCommand([...common,'--resume','--diagnose-company','141'],baseDeps(reader));assert.equal(third.status,'hard_stopped');assert.equal(third.failureStreak,3);assert.equal(third.hardStopped,true);assert.equal(third.companies.find((row:any)=>row.companyId==='143').status,'unattempted')
    assert.equal([...reads.entries()].find(([url])=>url.includes('bayt.com'))?.[1],1)
    const classified=JSON.parse(await readFile(join(storage,'cold-live','classified.json'),'utf8'));assert.equal(classified.collection.positions.length,1);assert.equal(classified.evaluation.pendingIds.length,1)
    const checkpoint=JSON.parse(await readFile(join(storage,'cold-live','benchmark-checkpoint.json'),'utf8'));assert.deepEqual(checkpoint.completedCompanyIds,['140','141','142']);assert.equal(checkpoint.sourceBudgets['67'].reads,1)
  } finally {await rm(storage,{recursive:true,force:true})}
})

test('quota admission stop wins before browser/profile mutation and saves a deterministic all-company report',async()=>{
  const storage=await mkdtemp(join(tmpdir(),'guarded-quota-')),campaign=await isolatedCampaign(storage);let browsers=0
  try {
    const result:any=await guardedBenchmarkCommand(['--mode','cold','--campaign',campaign,'--run','quota-stop','--storage',storage,'--execute'],{...baseDeps(async()=>{throw Error('reader must not start')},8),createBrowser:async()=>{browsers++;return {close:async()=>{}}}})
    assert.equal(result.status,'paused');assert.equal(result.stopReason,'quota_admission_stop');assert.equal(result.companies.length,20);assert.ok(result.companies.every((row:any)=>row.status==='unattempted'));assert.equal(browsers,0)
    await assert.rejects(access(join(storage,'quota-stop','browser-profile')))
  } finally {await rm(storage,{recursive:true,force:true})}
})

test('transfer runner uses the exact six unseen frozen IDs and reports unavailable reuse without bindings',async()=>{
  const storage=await mkdtemp(join(tmpdir(),'guarded-transfer-')),campaign=await isolatedCampaign(storage),seen:string[]=[]
  try {
    const result:any=await guardedBenchmarkCommand(['--mode','transfer','--campaign',campaign,'--run','transfer-live','--storage',storage,'--execute','--headless'],baseDeps(async url=>{seen.push(url);return {url,text:'No current positions',links:[],jobs:[],explicitlyEmpty:true}}))
    assert.equal(result.status,'complete',JSON.stringify(result.companies));assert.deepEqual(result.companies.map((row:any)=>row.companyId),['172','225','196','203','167','173']);assert.equal(seen.length,7)
    assert.ok(result.companies.flatMap((row:any)=>row.sources).every((source:any)=>source.reuse==='unavailable'));assert.equal(result.companies.find((row:any)=>row.companyId==='173').sources.length,2)
    assert.equal(JSON.parse(await readFile(join(storage,'transfer-live','accepted-vacancies.json'),'utf8')).count,0)
  } finally {await rm(storage,{recursive:true,force:true})}
})

test('a campaign hard stop persists across benchmark phases even if the counter later decreases',async()=>{
  const storage=await mkdtemp(join(tmpdir(),'guarded-shared-stop-')),campaign=await isolatedCampaign(storage)
  let browsers=0
  const deps=(used:number)=>({...baseDeps(async()=>{throw Error('reader must not start')},used),createBrowser:async()=>{browsers++;return {close:async()=>{}}}})
  try {
    const first:any=await guardedBenchmarkCommand(['--mode','cold','--campaign',campaign,'--run','quota-cold','--storage',storage,'--execute'],deps(9))
    assert.equal(first.status,'hard_stopped')
    const second:any=await guardedBenchmarkCommand(['--mode','transfer','--campaign',campaign,'--run','quota-transfer','--storage',storage,'--execute'],deps(5))
    assert.equal(second.status,'hard_stopped');assert.equal(browsers,0)
    assert.equal(JSON.parse(await readFile(join(campaign,'budget-status.json'),'utf8')).status,'hard_stopped')
  } finally {await rm(storage,{recursive:true,force:true})}
})

test('a mid-read quota visibility failure remains paused instead of returning running/within-budget',async()=>{
  const storage=await mkdtemp(join(tmpdir(),'guarded-mid-read-')),campaign=await isolatedCampaign(storage)
  let quotaReads=0,closed=false,reads=0
  try {
    const result:any=await guardedBenchmarkCommand(['--mode','cold','--campaign',campaign,'--run','visibility-loss','--storage',storage,'--execute'],{
      ...baseDeps(async url=>{reads++;await new Promise(r=>setTimeout(r,30));if(closed)throw Error('owned_browser_closed');return {url,text:'No current positions',links:[],jobs:[],explicitlyEmpty:true}}),
      readRateLimit:async()=>++quotaReads===1?quota(5):{},pollIntervalMs:1,createBrowser:async()=>({close:async()=>{closed=true}}),
    })
    assert.equal(result.status,'paused');assert.equal(result.stopReason,'rate_limit_missing')
    assert.ok(reads<=1);assert.equal(quotaReads,2);assert.equal(closed,true)
  } finally {await rm(storage,{recursive:true,force:true})}
})
