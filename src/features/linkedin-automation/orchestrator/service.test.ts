import test from 'node:test'
import assert from 'node:assert/strict'
import { createLinkedInOrchestrator } from './service.ts'
import { createMemoryAutomationStore } from './memory-store.ts'
import { createAutomationWriteGuard } from './execution-guard.ts'
import { features, type AutomationAdapters, type FeatureState } from './contracts.ts'
function fixture() {
  let time = Date.parse('2026-09-21T07:00:00Z'), online = true
  const store = createMemoryAutomationStore(), started: string[] = [], stopped: string[] = []
  const states = new Map<string,FeatureState>()
  const authority = { assertOwned() { if(!online) throw Object.assign(new Error('offline'),{code:'automation_writer_unavailable'}) }, async check() {this.assertOwned()} }
  const adapters = Object.fromEntries(features.map(feature => [feature, {
    async inspect() { return {ready:true} },
    async start(run: any) { if(!states.has(run.key)) { started.push(run.key); states.set(run.key,{ id:run.key,state:feature==='comments'?'monitoring':'running',owned:true }) }; return states.get(run.key)! },
    async status(run: any) { return states.get(run.key) }, async stop(run: any) {stopped.push(run.key);const s=states.get(run.key);if(s)s.state='stopped'}, async maintain() {}
  }])) as unknown as AutomationAdapters
  const make = () => createLinkedInOrchestrator({store,adapters,authority,now:()=>time,random:()=>0,accountExists:async()=>true},false)
  return { store, started, stopped, states, adapters, authority, make, now:()=>time, setTime:(n:number)=>time=n, offline:()=>online=false,
    input: {enabled:true,timezone:'Europe/Moscow',slots:[{id:'monday',day:1,start:'10:00',end:'20:00',features:['invitations','posts']}]}}
}
test('durable occurrences survive restart; same-account jobs serialize, different accounts run', async () => {
  const f=fixture(), s=f.make(); await s.update(1,f.input,0); await s.update(2,f.input,0)
  await s.tick(); assert.equal(f.started.length,2)
  assert.equal(new Set(f.started.map(k=>k.split(':')[0])).size,2)
  await s.close(); const next=f.make(); await next.tick(); assert.equal(f.started.length,2)
  for(const state of f.states.values()) state.state='completed'
  await next.tick(); assert.equal(f.started.length,2)
  f.setTime(Math.max(...(await f.store.runs()).filter(r=>r.date==='2026-09-21' && r.state==='planned').map(r=>r.plannedAt)))
  await next.tick(); assert.equal(f.started.length,4)
})

test('deferred verification releases the queue and still observes disable and deadlines', async()=>{
  const f=fixture(),service=f.make();await service.update(1,f.input,0);await service.tick()
  const first=(await f.store.runs(1)).find(r=>r.state==='running')!
  f.states.get(first.key)!.state='deferred'
  await service.tick()
  assert.equal((await f.store.runs(1)).find(r=>r.key===first.key)!.state,'deferred')
  const second=(await f.store.runs(1)).find(r=>r.date===first.date && r.state==='planned')!
  f.setTime(second.plannedAt);await service.tick()
  assert.equal(f.started.length,2,'A pending provider read must not block an independent feature.')
  f.setTime(first.deadlineAt!);await service.tick()
  assert.ok(f.stopped.includes(first.key))
  await service.update(1,{...f.input,enabled:false},1)
  assert.ok(f.stopped.includes(second.key))
})

test('more than two accounts execute concurrently, still only one task per account', async()=>{
  const f=fixture(), service=f.make()
  for(let account=1;account<=12;account++) await service.update(account,f.input,0)
  await service.tick()
  assert.equal(f.started.length,12)
  assert.equal(new Set(f.started.map(key=>key.split(':')[0])).size,12)
  await service.tick();assert.equal(f.started.length,12)
})

test('overrun preserves a random pause after completion and the new start survives restart',async()=>{
  const f=fixture(),service=f.make()
  await service.update(1,f.input,0);await service.tick()
  const first=(await f.store.runs(1)).find(r=>r.state==='running')!
  const second=(await f.store.runs(1)).find(r=>r.date===first.date && r.state==='planned')!
  const savedPause=20*60_000
  // Use a known persisted random gap so the assertion does not depend on the RNG.
  second.pauseBeforeMs=savedPause;await f.store.saveRun(second)
  const completedAt=second.plannedAt+60_000
  f.setTime(completedAt);await service.tick();assert.equal(f.started.length,1)
  f.states.get(first.key)!.state='completed';await service.tick()
  const delayed=(await f.store.runs(1)).find(r=>r.key===second.key)!
  assert.equal(delayed.plannedAt,completedAt+savedPause)
  assert.equal(delayed.reason,'waiting_for_pause')
  await service.close();const restarted=f.make();await restarted.tick()
  assert.equal((await f.store.runs(1)).find(r=>r.key===second.key)!.plannedAt,delayed.plannedAt)
  f.setTime(delayed.plannedAt-1);await restarted.tick();assert.equal(f.started.length,1)
  f.setTime(delayed.plannedAt);await restarted.tick();assert.equal(f.started.length,2)
})

test('a pause plus reserve that no longer fits skips the run without an out-of-slot start',async()=>{
  const f=fixture(),service=f.make();await service.update(1,f.input,0);await service.tick()
  const first=(await f.store.runs(1)).find(r=>r.state==='running')!
  const second=(await f.store.runs(1)).find(r=>r.date===first.date && r.state==='planned')!
  second.pauseBeforeMs=15*60_000;await f.store.saveRun(second)
  f.setTime(second.closesAt-second.reserveMs-1)
  f.states.get(first.key)!.state='completed';await service.tick()
  const skipped=(await f.store.runs(1)).find(r=>r.key===second.key)!
  assert.equal(skipped.state,'missed');assert.equal(skipped.reason,'insufficient_time')
  assert.equal(f.started.length,1)
})

test('monitor activation releases the queue once; polling never extends the next task pause',async()=>{
  const f=fixture(),service=f.make()
  await service.update(1,{...f.input,slots:[{...f.input.slots[0],start:'11:00',features:['comments','invitations']}]},0)
  await service.tick()
  const monitor=(await f.store.runs(1)).find(r=>r.state==='monitoring')!
  const next=(await f.store.runs(1)).find(r=>r.date===monitor.date && r.state==='planned')!
  assert.ok(monitor.releasedAt)
  f.setTime(next.plannedAt-1);await service.tick()
  assert.equal((await f.store.runs(1)).find(r=>r.key===monitor.key)!.releasedAt,monitor.releasedAt)
  f.setTime(next.plannedAt);await service.tick()
  assert.equal(f.started.length,2)
})

test('comments start immediately without posts, outside slot hours, and survive restart/week boundaries',async()=>{
  const f=fixture(),service=f.make()
  await service.update(1,{...f.input,slots:[{...f.input.slots[0],start:'15:00',end:'15:01',features:['comments']}]},0)
  await service.tick()
  const monitor=(await f.store.runs(1)).find(r=>r.state==='monitoring')!
  assert.ok(monitor);assert.equal(monitor.startedAt,f.now())
  assert.equal((await service.snapshot(1)).preview[0].tooShort,false)
  assert.equal((await f.store.runs(1)).filter(r=>r.feature==='comments').length,1)
  await service.close();const restarted=f.make()
  f.setTime(Date.parse('2026-09-21T21:00:00Z'));await restarted.tick()
  assert.equal((await f.store.runs(1))[0].reason,'automation_comments_inactive_day')
  f.setTime(Date.parse('2026-09-28T07:00:00Z'));await restarted.tick()
  assert.equal((await f.store.runs(1))[0].reason,undefined)
  assert.equal(f.started.length,1);assert.equal(f.stopped.length,0)
})

test('post-enabled monitor waits for confirmation, starts without random delay and never duplicates after restart',async()=>{
  const f=fixture(),service=f.make()
  await service.update(1,{...f.input,slots:[{...f.input.slots[0],features:['comments','posts']}]},0)
  await service.tick()
  assert.equal(f.started.length,1);assert.match(f.started[0],/:posts:/)
  const post=(await f.store.runs(1)).find(r=>r.state==='running')!
  const state=f.states.get(post.key)!
  state.reason='uncertain';await service.tick();assert.equal(f.started.length,1)
  state.state='completed';state.reason=undefined;state.publication={id:'confirmed',at:f.now()}
  await service.tick()
  const monitor=(await f.store.runs(1)).find(r=>r.state==='monitoring')!
  assert.equal(monitor.startedAt,f.now());assert.equal(f.started.length,2)
  await service.close();const restarted=f.make();await restarted.tick()
  assert.equal(f.started.length,2)
  await restarted.update(1,{...f.input,enabled:false},1)
  assert.ok(f.stopped.includes(monitor.key))
})

test('old random comment starts are replaced once and waiting comments can be disabled before publication',async()=>{
  const f=fixture(),service=f.make()
  const config={...f.input,slots:[{...f.input.slots[0],features:['comments','posts']}]}
  await service.update(1,config,0)
  await f.store.claim({key:'old',account:1,feature:'comments',date:'2026-09-21',slotId:'monday',
    opensAt:f.now(),closesAt:f.now()+3600000,plannedAt:f.now()+600000,reserveMs:1,state:'planned',updatedAt:f.now()})
  await service.tick()
  assert.equal((await f.store.runs(1)).find(r=>r.key==='old')!.reason,'comment_policy_changed')
  const monitor=(await f.store.runs(1)).find(r=>r.commentMode==='continuous')!
  assert.equal(monitor.state,'planned')
  await service.update(1,{...config,enabled:false},1);await service.tick()
  assert.equal((await f.store.runs(1)).find(r=>r.key===monitor.key)!.state,'cancelled')
  assert.equal(f.started.filter(k=>k.includes(':comments:')).length,0)
})

test('upgrade reads an already published post without starting or republishing it',async()=>{
  const f=fixture(),service=f.make()
  const key='1:posts:2026-09-21:10:00'
  await f.store.claim({key,feature:'posts',account:1,date:'2026-09-21',slotId:'monday',
    opensAt:f.now(),closesAt:f.now()+36000000,plannedAt:f.now(),reserveMs:1,state:'completed',updatedAt:f.now()})
  f.states.set(key,{id:key,state:'completed',owned:true,publication:{id:'already-posted',at:f.now()}})
  await service.update(1,{...f.input,slots:[{...f.input.slots[0],features:['comments','posts']}]},0)
  await service.tick()
  assert.equal(f.started.length,1);assert.match(f.started[0],/:comments:/)
  assert.equal((await f.store.runs(1)).find(r=>r.key===key)!.publication?.id,'already-posted')
})
test('disable persists before stopping; write guard blocks automatic writes but not manual writes', async () => {
  const f=fixture(), s=f.make(); await s.update(1,f.input,0); await s.tick()
  const key=f.started[0], feature=key.split(':')[1] as 'invitations'
  const guard=createAutomationWriteGuard(f.store,f.authority,undefined,f.now); await guard.beforeWrite(1,feature,key)
  await s.update(1,{...f.input,enabled:false},1)
  await assert.rejects(guard.beforeWrite(1,feature,key),{code:'automation_disabled'})
  await guard.beforeWrite(1,feature); assert.equal(f.stopped.length,1)
  await s.tick(); assert.equal(f.started.length,1)
})
test('short windows never start; active task can finish outside window without a new launch', async () => {
  const f=fixture(),s=f.make(); await s.update(1,{...f.input,slots:[{...f.input.slots[0],end:'15:00'}]},0); await s.tick()
  f.setTime(Date.parse('2026-09-21T12:01:00Z')); await s.tick(); assert.equal(f.stopped.length,0)
  f.states.get(f.started[0])!.state='completed'; await s.tick(); assert.equal(f.started.length,1)
  const short={...f.input,slots:[{...f.input.slots[0],end:'10:10'}]}; await s.update(2,short,0)
  assert.equal((await s.snapshot(2)).preview[0].tooShort,true)
})

test('duration deadline survives restart and stops the stuck task before admitting the next one',async()=>{
  const f=fixture(),service=f.make();await service.update(1,f.input,0);await service.tick()
  const first=(await f.store.runs(1)).find(r=>r.state==='running')!
  assert.equal(first.deadlineAt,first.startedAt!+first.reserveMs*2)
  await service.close();const restarted=f.make()
  f.setTime(first.deadlineAt!-1);await restarted.tick();assert.equal(f.stopped.length,0)
  assert.equal((await f.store.runs(1)).find(r=>r.key===first.key)!.deadlineAt,first.deadlineAt)
  f.setTime(first.deadlineAt!);await restarted.tick()
  assert.deepEqual(f.stopped,[first.key]);assert.equal(f.started.length,1)
  const timedOut=(await f.store.runs(1)).find(r=>r.key===first.key)!
  assert.equal(timedOut.state,'blocked');assert.equal(timedOut.reason,'task_time_limit')
  assert.ok((await f.store.events({runKey:first.key})).some(e=>e.code==='task_time_limit' && e.level==='error'))
  const next=(await f.store.runs(1)).find(r=>r.date===first.date && r.state==='planned')!
  f.setTime(next.plannedAt);await restarted.tick();assert.equal(f.started.length,2)
})

test('timeout cannot release an account whose sent request is still being checked',async()=>{
  const f=fixture(),service=f.make();await service.update(1,f.input,0);await service.tick()
  const first=(await f.store.runs(1)).find(r=>r.state==='running')!
  f.adapters[first.feature].stop=async run=>{f.stopped.push(run.key)}
  f.setTime(first.deadlineAt!);await service.tick();await service.tick()
  assert.equal(f.started.length,1)
  assert.equal((await f.store.runs(1)).find(r=>r.key===first.key)!.state,'running')
  const guard=createAutomationWriteGuard(f.store,f.authority,undefined,()=>first.deadlineAt!)
  await assert.rejects(guard.beforeWrite(1,first.feature,first.key),{code:'automation_task_timeout'})
  await guard.beforeWrite(1,first.feature)
  f.states.get(first.key)!.state='stopped';await service.tick()
  assert.equal((await f.store.runs(1)).find(r=>r.key===first.key)!.state,'blocked')
})

test('writer guard enforces a task deadline even before the scheduler has requested stop',async()=>{
  const f=fixture(),service=f.make();await service.update(1,f.input,0);await service.tick()
  const run=(await f.store.runs(1)).find(r=>r.state==='running')!
  const guard=createAutomationWriteGuard(f.store,f.authority,undefined,()=>run.deadlineAt!)
  await assert.rejects(guard.beforeWrite(1,run.feature,run.key),{code:'automation_task_timeout'})
  assert.equal((await f.store.runs(1)).find(r=>r.key===run.key)!.stopRequested,undefined)
})

test('failure to stop one expired account is logged without blocking new work for another account',async()=>{
  const f=fixture(),service=f.make();await service.update(1,f.input,0);await service.tick()
  const first=(await f.store.runs(1)).find(r=>r.state==='running')!
  f.adapters[first.feature].stop=async()=>{throw Object.assign(Error('unavailable'),{code:'unipile_timeout'})}
  f.setTime(first.deadlineAt!);await service.tick()
  await service.update(2,{...f.input,slots:[{...f.input.slots[0],features:['posts']}]},0)
  await service.tick()
  assert.equal(f.started.length,2)
  assert.ok(f.started.some(key=>key.startsWith('2:')))
  const failed=(await f.store.runs(1)).find(r=>r.key===first.key)!
  assert.equal(failed.stopReason,'task_time_limit');assert.equal(failed.reason,'unipile_timeout')
  assert.equal(failed.state,'running')
})
test('database/leadership loss fails closed and stale settings cannot overwrite off switch', async () => {
  const f=fixture(),s=f.make(); await s.update(1,f.input,0)
  await assert.rejects(s.update(1,f.input,0),{code:'automation_settings_conflict'})
  f.offline(); await assert.rejects(s.tick(),{code:'automation_writer_unavailable'}); assert.equal(f.started.length,0)
})

test('ordinary ticks preserve healthy heartbeat instead of pretending to recover on every pass', async()=>{
  const f=fixture(),states:string[]=[],heartbeat=f.store.heartbeat.bind(f.store)
  f.store.heartbeat=async value=>{if(value)states.push(value.state);return heartbeat(value)}
  const service=f.make()
  await service.tick()
  assert.deepEqual(states,['recovering','ready'])
  states.length=0
  await service.tick()
  assert.deepEqual(states,['ready','ready'])
  await service.close()
})
test('bulk edits affect only selected accounts and report conflicts individually', async () => {
  const f=fixture(),s=f.make(); await s.update(1,f.input,0)
  const results=await s.bulk([{account:1,settings:f.input,revision:0},{account:2,settings:f.input,revision:0}])
  assert.deepEqual(results.map(r=>r.ok),[false,true]); assert.equal((await f.store.settings()).length,2)
})

test('duration estimate is reserved before choosing the saved random start',async()=>{
  const f=fixture(),now=Date.parse('2026-09-21T07:00:00Z')
  f.adapters.invitations.inspect=async()=>({ready:true,estimateMs:6*3600000})
  const service=createLinkedInOrchestrator({store:f.store,adapters:f.adapters,authority:f.authority,
    now:()=>now,random:()=>0.99,accountExists:async()=>true},false)
  await service.update(1,{...f.input,slots:[{...f.input.slots[0],features:['invitations']}]},0)
  await service.tick()
  const run=(await f.store.runs(1)).find(r=>r.date==='2026-09-21')!
  assert.equal(run.reserveMs,6*3600000*1.3+600000)
  assert.ok(run.plannedAt+run.reserveMs<=run.closesAt)
  await service.tick();assert.equal((await f.store.runs(1)).find(r=>r.key===run.key)!.plannedAt,run.plannedAt)
})

test('off switch reaches durable storage while a feature start is awaiting a provider',async()=>{
  const f=fixture(),service=f.make()
  let entered!:()=>void,release!:()=>void,persisted!:()=>void
  const started=new Promise<void>(r=>entered=r),waiting=new Promise<void>(r=>release=r),disabled=new Promise<void>(r=>persisted=r)
  const originalStart=f.adapters.invitations.start,originalSave=f.store.saveSettings
  f.adapters.invitations.start=async run=>{entered();await waiting;return originalStart(run)}
  f.store.saveSettings=async(...args)=>{const value=await originalSave(...args);if(!value.enabled)persisted();return value}
  await service.update(1,{...f.input,slots:[{...f.input.slots[0],features:['invitations']}]},0)
  const tick=service.tick();await started
  const off=service.update(1,{...f.input,enabled:false},1);await disabled
  const key=(await f.store.runs(1)).find(r=>r.state==='starting')!.key
  await assert.rejects(createAutomationWriteGuard(f.store,f.authority).beforeWrite(1,'invitations',key),{code:'automation_disabled'})
  release();await tick;await off
  assert.equal((await f.store.runs(1)).find(r=>r.key===key)!.state,'cancelled')
})


test('a readiness cooldown reschedules durably without starving comments or probing every tick',async()=>{
  for (const delay of [3600000,24*3600000]) {
    const f=fixture(),service=f.make();let reads=0
    f.adapters.invitations.inspect=async()=>{reads++;throw Object.assign(Error('quota'),{
      code:'unipile_api_too_many_requests',details:{retryAfterMs:delay}})}
    await service.update(1,{...f.input,slots:[{...f.input.slots[0],features:['invitations','comments']}]},0)
    await service.tick()
    const run=(await f.store.runs(1)).find(r=>r.feature==='invitations'&&r.date==='2026-09-21')!
    assert.equal(run.state,delay===3600000?'planned':'missed')
    assert.equal(run.nextActionAt,f.now()+delay)
    assert.ok((await f.store.runs(1)).some(r=>r.feature==='comments'&&r.state==='monitoring'))
    const before=reads;await service.tick();assert.equal(reads,before)
    await service.close();const restored=f.make();await restored.tick();assert.equal(reads,before)
    assert.equal((await f.store.runs(1)).find(r=>r.key===run.key)!.plannedAt,run.plannedAt)
  }
})
