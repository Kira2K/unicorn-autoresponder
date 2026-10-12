import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createQuotaGuard} from '../infrastructure/quota-guard.ts'
import {createBudgetWatchdog} from '../infrastructure/budget-watchdog.ts'

const start=Date.parse('2026-10-03T17:00:00Z')
const policy={version:1 as const,campaignId:'recovery',baseline:{observedAt:new Date(start).toISOString(),limitId:'codex',windowMinutes:10080,usedPercent:5,resetsAt:1791595450},allowancePoints:10,bufferPoints:1.5,pauseAtPercent:13.5,stopAtPercent:15}
const reading=(used=6,reset=policy.baseline.resetsAt)=>({rateLimitsByLimitId:{codex:{secondary:{usedPercent:used,windowDurationMins:10080,resetsAt:reset}}}})
async function setup(run:(x:any)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'quota-recovery-'));try{let clock=start;const guard=createQuotaGuard(policy,{statePath:join(root,'state.json'),now:()=>clock});const reports:any[]=[];let cancelled=0;const options={guard,reportPath:join(root,'report.json'),now:()=>clock,retrySleep:async(ms:number)=>{clock+=ms},writeReport:async(_p:string,r:any)=>{reports.push(r)},cancelOwnedWork:async()=>{cancelled++}};await run({guard,options,reports,cancelled:()=>cancelled,advance:(ms:number)=>{clock+=ms}})}finally{await rm(root,{recursive:true,force:true})}}

test('transient quota failure blocks admission then recovers in the same worker without rebasing',()=>setup(async({guard,options,reports,cancelled}:any)=>{
  let calls=0,release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r)
  const watchdog=createBudgetWatchdog({...options,readRateLimit:async()=>{calls++;if(calls===2)throw Error('codex_app_server_timeout');return reading()},retrySleep:async()=>{entered();await new Promise<void>(r=>release=r)}})
  await watchdog.preflight({live:true});const poll=watchdog.pollOnce();await ready
  assert.equal(watchdog.admission().allowed,false);assert.equal(watchdog.signal.aborted,false)
  let admitted=false;const admission=watchdog.waitForAdmission().then(()=>{admitted=true});await Promise.resolve();assert.equal(admitted,false)
  release();await poll;await admission
  assert.equal(calls,3);assert.equal(cancelled(),0);assert.equal(guard.policy.baseline.usedPercent,5);assert.equal(guard.latest().observation.usedPercent,6)
  assert.equal(reports.at(-1).recovery.recovered,1);assert.equal(reports.at(-1).recovery.errors[0].category,'timeout')
}))
test('persistent transport failure stops after three reads and cancels exactly once',()=>setup(async({options,cancelled,reports}:any)=>{
  let calls=0;const w=createBudgetWatchdog({...options,readRateLimit:async()=>{calls++;throw Error('codex_app_server_timeout')}})
  await assert.rejects(w.preflight({live:true}),/rate_limit_read_failed/);assert.equal(calls,3);assert.equal(cancelled(),1)
  await w.pollOnce();assert.equal(calls,3);assert.equal(reports.at(-1).recovery.errors.length,3)
}))
test('authentication, invalid window and hard limit never become recoverable allowance',()=>setup(async({options}:any)=>{
  for(const value of ['auth','window','limit']){let calls=0;const w=createBudgetWatchdog({...options,readRateLimit:async()=>{calls++;if(value==='auth')throw Error('codex_app_server_auth_required');return value==='window'?reading(6,policy.baseline.resetsAt+100):reading(15)}})
    await assert.rejects(w.preflight({live:true}));assert.equal(calls,1);assert.equal(w.signal.aborted,true)}
}))
test('recovery does not grant an active worker more than thirty seconds without a valid observation',()=>setup(async({options,advance,cancelled}:any)=>{
  let calls=0;const w=createBudgetWatchdog({...options,readRateLimit:async()=>{calls++;if(calls>1){advance(31000);throw Error('codex_app_server_timeout')}return reading()}})
  await w.preflight({live:true});await w.pollOnce();assert.equal(calls,2);assert.equal(cancelled(),1);assert.equal(w.signal.aborted,true)
}))
