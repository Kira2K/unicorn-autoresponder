import test from 'node:test'
import assert from 'node:assert/strict'
import {createMemoryAutomationStore} from './memory-store.ts'
import {safeDetails,createAutomationAudit} from './audit.ts'
import {readAutomationDiagnostics} from './diagnostics.ts'
import {createAutomationWriteGuard} from './execution-guard.ts'
import {emptySettings} from './contracts.ts'
test('day four diagnostics retain exact stage and error; stale heartbeat never looks healthy',async()=>{
  const store=createMemoryAutomationStore(),at=100000
  await store.heartbeat({instance:'test',startedAt:at,at,state:'ready'})
  await store.appendEvent({at,account:7,runKey:'7:posts:2026-09-21:10:00',feature:'posts',stage:'publish_readback',
    code:'unipile_timeout',level:'error',details:{httpStatus:504,attempt:3}})
  const day4=await readAutomationDiagnostics(store,at+4*86400000)
  assert.equal(day4.healthy,false);assert.equal(day4.code,'worker_stale')
  assert.equal(day4.events[0].stage,'publish_readback');assert.equal(day4.events[0].code,'unipile_timeout')
  assert.equal((await readAutomationDiagnostics(store,at+100)).healthy,true)
})
test('journal pagination and account filters preserve older events',async()=>{
  const store=createMemoryAutomationStore()
  for(let i=0;i<6;i++)await store.appendEvent({at:i,account:i%2+1,stage:'poll',code:'running',level:'info'})
  const first=await store.events({account:1,limit:2}),second=await store.events({account:1,before:first.at(-1)!.id,limit:2})
  assert.deepEqual([...first,...second].map(e=>e.id),[5,3,1])
})
test('arbitrary messages, tokens, cookies, URLs and resume content never enter safe details',()=>{
  const secret='token-secret-value'
  const value=safeDetails({token:secret,cookie:secret,message:secret,body:secret,url:'https://host/token',
    code:'unipile_timeout',httpStatus:503,attempt:4,stage:'https://host/token'})
  assert.deepEqual(value,{code:'unipile_timeout',httpStatus:503,attempt:4})
})
test('failed durable logging closes automatic and manual provider write guards',async()=>{
  const store=createMemoryAutomationStore(),audit=createAutomationAudit(store,()=>1)
  await store.claim({key:'key',account:1,feature:'posts',date:'2026-09-21',slotId:'one',opensAt:0,closesAt:1,
    plannedAt:0,reserveMs:0,state:'running',updatedAt:0,featureRunId:'post'})
  store.appendEvent=async()=>{throw Error('db down')}
  audit.logger('posts')('publish_started',{account:1,runId:'post'})
  const guard=createAutomationWriteGuard(store,{assertOwned(){},async check(){}},audit)
  await assert.rejects(guard.beforeWrite(1,'posts'),{code:'automation_audit_unavailable'})
})
test('settings off is checked on every write and failure to save intent prevents provider call',async()=>{
  const store=createMemoryAutomationStore(),authority={assertOwned(){},async check(){}}
  const config={...emptySettings(1),enabled:true,revision:1,slots:[{id:'one',day:1,start:'10:00',end:'18:00',features:['posts' as const]}]}
  await store.saveSettings(config,0)
  await store.claim({key:'key',account:1,feature:'posts',date:'2026-09-21',slotId:'one',opensAt:0,closesAt:1,
    plannedAt:0,reserveMs:0,state:'running',updatedAt:0})
  const guard=createAutomationWriteGuard(store,authority)
  await guard.beforeWrite(1,'posts','key')
  store.appendEvent=async()=>{throw Error('storage failed')}
  await assert.rejects(guard.beforeWrite(1,'posts','key'),/storage failed/)
  await store.saveSettings({...config,enabled:false,revision:2},1)
  await assert.rejects(guard.beforeWrite(1,'posts','key'),{code:'automation_disabled'})
})

test('startup failures without a run ID are retained and first post checkpoints link to their automatic run',async()=>{
  const store=createMemoryAutomationStore(),audit=createAutomationAudit(store,()=>1)
  await store.claim({key:'slot',account:7,feature:'posts',date:'2026-09-21',slotId:'one',opensAt:0,closesAt:1,
    plannedAt:0,reserveMs:0,state:'starting',updatedAt:0})
  audit.logger('posts')('run_checkpoint',{account:7,automationKey:'slot',runId:'post',status:'queued'})
  audit.logger('posts')('startup_blocked',{code:'post_writer_lease_active'})
  await audit.flush()
  const events=await store.events({})
  assert.ok(events.some(e=>e.runKey==='slot'&&e.stage==='run_checkpoint'))
  assert.ok(events.some(e=>e.code==='post_writer_lease_active'&&e.level==='error'))
})
