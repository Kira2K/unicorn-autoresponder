import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryAutomationStore } from './memory-store.ts'
import { createAutomationWriteGuard } from './execution-guard.ts'
import { createFeatureAdapters } from './adapters.ts'
import { emptySettings, type AutomationRun } from './contracts.ts'
import { pollMonitorJob } from '../comment-monitor/poll-job.ts'
import { publishReplies } from '../comment-monitor/reply-publisher.ts'
import { createCommentUnipileAdapter } from '../comment-monitor/unipile-adapter.ts'

const logger={event(){}}
const now=Date.parse('2026-09-21T07:00:00Z')
const monitor:AutomationRun={key:'monitor',account:7,feature:'comments',date:'2026-09-21',slotId:'continuous',
  opensAt:now,closesAt:now,plannedAt:now,reserveMs:0,state:'monitoring',updatedAt:now,featureRunId:'job',commentMode:'continuous'}
async function fixture() {
  const store=createMemoryAutomationStore(),authority={assertOwned(){},async check(){}}
  await store.saveSettings({...emptySettings(7),revision:1,enabled:true,slots:[
    {id:'one',day:1,start:'15:00',end:'18:00',features:['comments','invitations']}]},0)
  await store.claim(monitor)
  let time=now
  return {store,guard:createAutomationWriteGuard(store,authority,undefined,()=>time),setTime:(at:number)=>time=at}
}
test('each automatic write enforces active days and yields to due work; manual comments bypass automatic calendar',async()=>{
  const f=await fixture()
  await f.guard.beforeWrite(7,'comments',monitor.key)
  await f.store.claim({...monitor,key:'invites',feature:'invitations',state:'planned',closesAt:now+60000})
  await assert.rejects(f.guard.beforeWrite(7,'comments',monitor.key),{code:'automation_comments_yielding'})
  await f.guard.beforeWrite(7,'comments')
  const run=(await f.store.runs()).find(r=>r.key==='invites')!;run.state='completed';await f.store.saveRun(run)
  await f.guard.beforeWrite(7,'comments',monitor.key)
  f.setTime(Date.parse('2026-09-21T21:00:00Z'))
  await assert.rejects(f.guard.beforeWrite(7,'comments',monitor.key),{code:'automation_comments_inactive_day'})
  await f.guard.beforeWrite(7,'comments')
})
test('a restored automatic monitor yields before provider access and account acquisition',async()=>{
  const f=await fixture();f.setTime(Date.parse('2026-09-21T21:00:00Z'))
  let external=0
  const job:any={jobId:'job',platformAccountId:7,status:'waiting',expiresAt:new Date(Date.now()+60000).toISOString(),
    state:{automationKey:'monitor',posts:[],items:[],knownIds:[],published:3,threadReplies:{thread:2}}}
  await pollMonitorJob({job,logger,store:{async update(){}},adapter:{async listComments(){external++}},openai:{},
    gate:{acquire(){throw Error('Must yield before taking account')}},executionGuard:f.guard})
  assert.equal(external,0);assert.equal(job.status,'waiting');assert.equal(job.stage,'automation_comments_inactive_day')
  assert.equal(job.state.published,3);assert.equal(job.state.threadReplies.thread,2)
})
const replyJob=()=>({jobId:'job',platformAccountId:7,accountId:'synthetic',status:'replying',
  expiresAt:new Date(Date.now()+60000).toISOString(),
  state:{automationKey:'monitor',published:0,failed:0,items:[],knownIds:[],threadReplies:{}}} as any)
const item=(id:string)=>({incomingId:id,postId:'post',parentId:id,threadId:id,replyText:'A useful reply.',status:'queued'} as any)
test('priority change inside provider queue prevents HTTP and leaves the unsent reply retryable',async()=>{
  const job=replyJob(),value=item('incoming');job.state.items=[value]
  let due=false,writes=0
  const adapter=createCommentUnipileAdapter({http:{async request(){writes++;return {id:'response'}}},
    scheduler:{async run(action:any){due=true;return action()}}})
  await assert.rejects(publishReplies({job,items:[value],adapter,logger,save:async()=>{},
    executionGuard:{async beforeWrite(){if(due)throw Object.assign(Error('pause'),{code:'automation_comments_yielding'})}}}),
    {code:'automation_comments_yielding'})
  assert.equal(writes,0);assert.equal(value.status,'queued');assert.equal(job.state.failed,0)
})
test('priority change after HTTP still verifies that reply, then stops before the next reply',async()=>{
  const job=replyJob(),items=[item('first'),item('second')];job.state.items=items
  let due=false,writes=0,reads=0
  await assert.rejects(publishReplies({job,items,logger,save:async()=>{},sleep:async()=>{},
    executionGuard:{async beforeWrite(){if(due)throw Object.assign(Error('pause'),{code:'automation_comments_yielding'})}},
    adapter:{async reply(){writes++;due=true;return {id:'confirmed'}},
      async listReplies(){reads++;return {items:[{id:'confirmed',text:items[0].replyText,is_sender:true}]}}}}),
    {code:'automation_comments_yielding'})
  assert.equal(writes,1);assert.equal(reads,1);assert.equal(items[0].status,'verified')
  assert.equal(items[1].status,'queued');assert.equal(job.state.published,1)
})
test('only confirmed publication unlocks comments; likes do not hide publication evidence; subsequent posts reach the monitor',async()=>{
  let status='uncertain';let observed:any
  const post:any={id:'post',automationKey:'post-key',status,trigger:'scheduled',postId:'verified',publishedAt:now,
    draft:{text:'Post text'},engagement:{status:'pending'}}
  const adapters=createFeatureAdapters({now:()=>now,gate:{current(){}},invitations:{} as any,
    posts:{async get(){return {runs:[{...post,status}]}}} as any,
    comments:{async ensureAutomatic(_account:any,_key:any,publication:any){observed=publication;return {jobId:'job',status:'waiting',state:{automationKey:'monitor'}}}} as any})
  const postRun={...monitor,key:'post-key',feature:'posts' as const,featureRunId:'post'}
  assert.equal((await adapters.posts.status(postRun))!.publication,undefined)
  status='published'
  assert.equal((await adapters.posts.status(postRun))!.state,'running')
  assert.deepEqual((await adapters.posts.status(postRun))!.publication,{id:'verified',at:now})
  await adapters.comments.maintain!({...monitor,publication:{id:'verified',at:now}})
  assert.equal(observed.id,'verified');assert.equal(observed.text,'Post text')
})

test('comment-only automation can start when Post Writer is unavailable',async()=>{
  let started=0
  const adapters=createFeatureAdapters({now:()=>now,gate:{current(){}},invitations:{} as any,
    posts:{async get(){throw Error('Post Writer must not be required')}} as any,
    comments:{async ensureAutomatic(){started++;return {jobId:'job',status:'waiting',state:{automationKey:'monitor'}}}} as any})
  assert.equal((await adapters.comments.start(monitor)).state,'monitoring');assert.equal(started,1)
})
