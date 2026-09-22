import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fixture as posts} from '../post-writer/tests/helpers.ts'
import {fixture as withdrawals,finished} from '../invitation-withdrawal/test-fixture.ts'
import {createInvitationWithdrawal} from '../invitation-withdrawal/service.ts'
import {defaults} from '../post-writer/types.ts'
import {retainMonitorEvidence} from '../comment-monitor/retention-policy.ts'
import {processRun} from '../post-writer/process-run.ts'
const {createCommentMonitorService}=createRequire(`${process.cwd()}/package.json`)('./src/features/linkedin-automation/comment-monitor/service.ts')
test('orchestrated posts use the existing daily key; legacy schedule hands over and manual remains manual',async()=>{
  const f=posts();f.deps.schedulingManaged=async()=>true
  await f.service.update(203,{...defaults(203),scheduled:true,days:[1],intervals:[{start:'09:00',end:'18:00'}]})
  await f.step();assert.equal((await f.service.get(203)).runs.length,0)
  const first=await f.service.startScheduled(203,'2026-09-07','slot-one')
  await f.untilPublished()
  const second=await f.service.startScheduled(203,'2026-09-07','slot-two')
  assert.equal(first.id,second.id);assert.equal(f.counts.publish,1)
  const manual=await f.service.start(203,'approval_required','manual-test-request')
  assert.equal(manual.automationKey,undefined);await f.service.close()
})
test('automatic withdrawal omits manual confirmation but preserves age policy and durable replay protection',async()=>{
  const f=withdrawals();let guards=0
  f.runtime.executionGuard={async beforeWrite(){guards++}}
  const run=await f.service.startAutomatic!(1,'slot-one');await finished(f.service)
  assert.equal((await f.service.startAutomatic!(1,'slot-one')).id,run.id)
  assert.deepEqual(f.calls,['1','2']);assert.ok(guards>=3)
  const restarted=createInvitationWithdrawal(f.runtime)
  assert.equal((await restarted.startAutomatic!(1,'slot-one')).id,run.id)
  assert.deepEqual(f.calls,['1','2'])
  const next=await restarted.startAutomatic!(1,'slot-two');await finished(restarted)
  assert.equal(next.total,0);assert.deepEqual(f.calls,['1','2']);await restarted.close()
})
test('automatic withdrawal reconciles an interrupted intent before continuing and never repeats it',async()=>{
  const f=withdrawals()
  const account=await f.runtime.account(1)
  f.pending([{id:'2',name:'Synthetic',createdAt:'2026-08-01T00:00:00Z'}])
  await f.runtime.store.save(1,{accountId:account.accountId,attempted:['1'],run:{id:'prior',automationKey:'slot',
    platformAccountId:1,accountId:account.accountId,status:'running',total:2,withdrawn:0,skipped:0,current:'1'}})
  const restarted=createInvitationWithdrawal(f.runtime)
  await restarted.startAutomatic!(1,'slot');await finished(restarted)
  assert.deepEqual(f.calls,['2']);assert.deepEqual(f.stored()?.attempted,['1','2'])
  await restarted.close()
})
test('withdrawal deadline stops the next POST but retains read-back of the first sent request',async()=>{
  const f=withdrawals();let expired=false
  const cancel=f.provider.cancel
  f.provider.cancel=async(account,id)=>{await cancel(account,id);expired=true}
  f.runtime.executionGuard={async beforeWrite(){
    if(expired)throw Object.assign(Error('deadline'),{code:'automation_task_timeout'})
  }}
  await f.service.startAutomatic!(1,'timed-slot');await finished(f.service)
  assert.deepEqual(f.calls,['1'])
  const run=await f.service.status(1)
  assert.equal(run?.withdrawn,1);assert.equal(run?.status,'stopped')
  assert.equal(run?.errorCode,'automation_task_timeout')
  assert.deepEqual(f.stored()?.attempted,['1']);await f.service.close()
})
function monitorFixture(seed:any){
  const data=new Map([[seed.jobId,structuredClone(seed)]]),events:string[]=[]
  const store={async list(){return structuredClone([...data.values()])},async get(id:string){return structuredClone(data.get(id))},
    async create(j:any){data.set(j.jobId,structuredClone(j))},async update(j:any){data.set(j.jobId,structuredClone(j))},async purge(){}}
  const service=createCommentMonitorService({autoStart:false,store,loggerFor:()=>({event(){}}),
    repository:{async listAccounts(){return [{platformAccountId:7,clientName:'Synthetic',unipileAccountId:'fake',unipileAccountStatus:'running',lastVerifiedAt:'now'}]}},
    adapter:{async getAccount(){return {user_id:'author'}},async listPosts(){events.push('select_posts');return {items:[{id:'new',text:'new',created_at:new Date().toISOString()}]}},
      async listReplies(){events.push('readback');return {items:[{id:'reply',is_sender:true,text:'Test reply'}]}},async listComments(){return {items:[]}}},
    openai:{async generate(){throw Error('No generation expected')}},executionGuard:{async beforeWrite(){events.push('guard')}}})
  return {service,data,events}
}
const seed=(now:number)=>({jobId:'job',platformAccountId:7,accountId:'fake',clientName:'Synthetic',status:'completed',stage:'limit_reached',
  createdAt:new Date(now-1000).toISOString(),updatedAt:new Date(now).toISOString(),expiresAt:new Date(now+100000).toISOString(),
  state:{automationKey:'slot',posts:[],items:[],knownIds:['old'],checks:1,discovered:30,published:30,failed:0,threadReplies:{thread:7}}})
test('thirty comments do not renew early; renewal after 48h retains known IDs and thread quota',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-21T10:00:00Z')})
  const f=monitorFixture(seed(Date.now()))
  assert.equal((await f.service.ensureAutomatic(7,'slot')).state.published,30)
  assert.equal(f.events.includes('select_posts'),false)
  t.mock.timers.tick(100001)
  const renewed=await f.service.ensureAutomatic(7,'slot')
  assert.equal(renewed.state.published,0);assert.deepEqual(renewed.state.knownIds,['old']);assert.equal(renewed.state.threadReplies.thread,7)
  assert.equal(Date.parse(renewed.expiresAt)-Date.parse(renewed.createdAt),48*3600000)
  f.service.stop()
})

test('new posts refresh an existing monitor without resetting its quota, 48h period or reply evidence',async()=>{
  const row:any=seed(Date.now())
  row.state.posts=[{id:'old-post',text:'Old',createdAt:new Date(Date.now()-5000).toISOString()}]
  row.state.items=[{incomingId:'old',status:'verified'}]
  const f=monitorFixture(row),publication={id:'new-post',text:'Confirmed new post',createdAt:new Date().toISOString()}
  const updated=await f.service.ensureAutomatic(7,'slot',publication)
  assert.deepEqual(updated.state.posts.map((p:any)=>p.id),['new-post','old-post'])
  assert.equal(updated.state.published,30);assert.equal(updated.expiresAt,row.expiresAt)
  assert.deepEqual(updated.state.items,row.state.items);assert.deepEqual(updated.state.knownIds,['old'])
  assert.equal(updated.state.threadReplies.thread,7)
  const again=await f.service.ensureAutomatic(7,'slot',publication)
  assert.equal(again.state.posts.length,2);assert.equal(f.events.includes('select_posts'),false)
  await f.service.stop()
})
test('uncertain comment must be read back before expired session renewal; the incoming ID survives',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-21T10:00:00Z')})
  const row:any=seed(Date.now());row.expiresAt=new Date(Date.now()-1).toISOString();row.status='paused';row.state.published=1
  row.state.items=[{incomingId:'old',postId:'p',parentId:'old',threadId:'thread',status:'uncertain',replyText:'Test reply'}]
  const f=monitorFixture(row)
  await f.service.ensureAutomatic(7,'slot');assert.equal(f.events.includes('select_posts'),false)
  t.mock.timers.tick(300001)
  const renewed=await f.service.ensureAutomatic(7,'slot')
  assert.ok(f.events.indexOf('readback')<f.events.indexOf('select_posts'));assert.ok(f.events.includes('readback'))
  assert.ok(renewed.state.knownIds.includes('old'));assert.equal(renewed.state.threadReplies.thread,8)
  f.service.stop()
})

test('simultaneous manual and automatic monitor enable creates only one session',async()=>{
  const f=monitorFixture(seed(Date.now()))
  const [manual,automatic]=await Promise.all([f.service.enable(7),f.service.ensureAutomatic(7,'new-slot')])
  assert.equal(manual.jobId,automatic.jobId)
  assert.equal(f.events.filter(e=>e==='select_posts').length,1)
  await f.service.stop()
})

test('retention preserves lifetime automatic deduplication and unresolved manual replies',()=>{
  const row:any=seed(1)
  assert.equal(retainMonitorEvidence(row),true)
  delete row.state.automationKey;assert.equal(retainMonitorEvidence(row),false)
  row.state.items=[{status:'uncertain'}];assert.equal(retainMonitorEvidence(row),true)
})

test('disabling and reenabling comments in another slot cannot reset the original 48-hour quota',async()=>{
  const previous=seed(Date.now()),f=monitorFixture(previous)
  const restarted=await f.service.ensureAutomatic(7,'next-slot')
  assert.equal(restarted.state.automationKey,'next-slot')
  assert.equal(restarted.state.published,30)
  assert.equal(restarted.expiresAt,previous.expiresAt)
  await f.service.stop()
})

test('worker shutdown keeps a queued post resumable instead of blocking the day permanently',async()=>{
  const row:any={id:'post',account:7,status:'queued',automationKey:'slot',engagement:{items:[],status:'off'}}
  let saved=false
  await processRun(row,{writable:true,now:()=>1000,release:new Map(),log(){},async save(){saved=true},
    executionGuard:{async beforeWrite(){throw Object.assign(Error('stopping'),{code:'automation_worker_stopping'})}}} as any)
  assert.equal(row.status,'queued');assert.equal(row.errorCode,'automation_worker_stopping')
  assert.ok(row.nextActionAt>1000);assert.ok(saved)
})
