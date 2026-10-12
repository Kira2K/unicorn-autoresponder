import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectBenchmarkBatch, batchBudget, benchmarkBatchCommand } from '../benchmark/batch-command.ts'

const now = Date.parse('2026-09-29T23:00:00Z')
const baseline = { observedAt: new Date(now).toISOString(), limitId:'codex', windowMinutes:10080, usedPercent:10, resetsAt:1791292389 }
const policy = { version:1 as const,campaignId:'batch-test',baseline,allowancePoints:5,bufferPoints:1,pauseAtPercent:14,stopAtPercent:15 }
const ids=Array.from({length:30},(_,i)=>String(200+i))
const frozen = {catalog:{companyIds:ids,companies:ids.map(id=>({id,name:'Company '+id})),sources:ids.map(id=>({name:'Company '+id,url:`https://company-${id}.test/careers`,database:{companyId:id,sourceId:id,applicationRoute:'standard_workflow'}})),deferred:[{id:'deferred',companyId:'229',reason:'adapter_required:telegram'}],issues:['company:229:fixture_issue']},scope:{}}

test('batch selection keeps exactly five companies and their associated coverage issues',()=>{
  const first=selectBenchmarkBatch(frozen,1),last=selectBenchmarkBatch(frozen,6)
  assert.equal(first.catalog.sources.length,5);assert.deepEqual(first.catalog.deferred,[]);assert.deepEqual(first.catalog.issues,[])
  assert.deepEqual(last.catalog.companyIds,ids.slice(25));assert.equal(last.catalog.deferred.length,1)
  assert.throws(()=>selectBenchmarkBatch(frozen,7),/six_batches/)
})
test('one-point batch budget never extends the original campaign ceiling',()=>{
  const budget=batchBudget(policy,{...baseline,usedPercent:13},1)
  assert.equal(budget.stopAtPercent,14);assert.equal(budget.pauseAtPercent,13.75)
  assert.throws(()=>batchBudget(policy,{...baseline,usedPercent:14},2),/does_not_admit/)
})
test('five-company execution skips hard sources, records the half-point limitation, and resumes without resetting usage',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'five-company-budget-'))
  let used=11,reads=0,browsers=0
  try {
    const reference=JSON.parse(await readFile('logs/external-responses/sol-three-successes-20260930/frozen-scope.json','utf8'))
    await writeFile(join(directory,'frozen-scope.json'),JSON.stringify({...frozen,scope:reference.scope}))
    await writeFile(join(directory,'budget.json'),JSON.stringify(policy))
    await writeFile(join(directory,'cancellation-preflight.json'),JSON.stringify({passed:true,status:'interrupted',requestedInterrupt:true,paidApiCalls:0}))
    const deps={now:()=>now,readRateLimit:async()=>({rateLimitsByLimitId:{codex:{weekly:{windowDurationMins:10080,usedPercent:used,resetsAt:baseline.resetsAt}}}}),closeRateLimit:async()=>{},acquireCollectionLock:async()=>async()=>{},createBrowser:async()=>{browsers++;return{close:async()=>{}}},createReader:()=>({read:async(url:string)=>{reads++;return url.includes('200.test')?{url,text:'Unresolved dynamic widget',links:[],jobs:[],partial:true}:{url,text:'No open jobs',links:[],jobs:[],explicitlyEmpty:true}}})}
    const args=['--campaign',directory,'--batch','1','--execute']
    const result=await benchmarkBatchCommand(args,deps)
    assert.equal(result.completedCompanies.length,5);assert.equal(result.completeCompanies.length,4)
    assert.equal(result.aiRepairCalls,0);assert.ok(result.sources[0].issues.some((s:string)=>s.includes('quota_precision_insufficient')))
    const replayed=await benchmarkBatchCommand([...args,'--replay'],deps)
    assert.equal(replayed.completeCompanies.length,4)
    assert.ok(replayed.sources.filter((s:any)=>s.status==='complete').every((s:any)=>s.reuse==='recipe_replay'))
    const before=reads;used=12
    const resumed=await benchmarkBatchCommand([...args,'--resume'],deps)
    assert.equal(reads,before);assert.equal(browsers,2);assert.equal(resumed.batchBudget.baseline.usedPercent,11)
    const budget=JSON.parse(await readFile(join(directory,'batches','1','budget.json'),'utf8'));assert.equal(budget.stopAtPercent,12)
  } finally {await rm(directory,{recursive:true,force:true})}
})
