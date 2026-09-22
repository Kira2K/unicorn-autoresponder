import test from 'node:test'
import assert from 'node:assert/strict'
import { commentWaitReason } from './comment-policy.ts'
import { emptySettings, type AutomationRun } from './contracts.ts'

const now = Date.parse('2026-09-21T07:00:00Z')
const config = {...emptySettings(7),enabled:true,slots:[
  {id:'one',day:1,start:'15:00',end:'18:00',features:['comments' as const]},
  {id:'two',day:2,start:'15:00',end:'18:00',features:['invitations' as const]}]}
const monitor:AutomationRun = {key:'monitor',feature:'comments',account:7,commentMode:'continuous',
  date:'2026-09-21',slotId:'continuous',opensAt:now,closesAt:now,plannedAt:now,reserveMs:0,state:'planned',updatedAt:now}
const post:AutomationRun = {...monitor,key:'post',feature:'posts',state:'completed',publication:{id:'verified',at:now}}

test('comments start before the slot without posts and operate on every active weekday, using Moscow midnight',()=>{
  assert.equal(commentWaitReason(config,[],monitor,now),undefined)
  assert.equal(commentWaitReason(config,[],monitor,Date.parse('2026-09-22T20:59:59Z')),undefined)
  assert.equal(commentWaitReason(config,[],monitor,Date.parse('2026-09-22T21:00:00Z')),'automation_comments_inactive_day')
  assert.equal(commentWaitReason({...config,enabled:false},[],monitor,now),'automation_disabled')
})
test('first activation waits for a verified post, but no ten minute delay or new daily publication is required',()=>{
  const withPosts={...config,slots:[...config.slots,{...config.slots[0],id:'posts',features:['posts' as const]}]}
  assert.equal(commentWaitReason(withPosts,[],monitor,now),'automation_comments_waiting_for_post')
  assert.equal(commentWaitReason(withPosts,[{...post,publication:undefined}],monitor,now),'automation_comments_waiting_for_post')
  assert.equal(commentWaitReason(withPosts,[{...post,publication:{id:'old',at:now-86400000}}],monitor,now),'automation_comments_waiting_for_post')
  assert.equal(commentWaitReason(withPosts,[post],monitor,now),undefined)
  assert.equal(commentWaitReason(withPosts,[],{...monitor,featureRunId:'existing'},now+86400000),undefined)
})
test('due and running same-account tasks take priority, future/finished/other-account work does not',()=>{
  for(const state of ['planned','starting','running'] as const) {
    const other={...post,state,closesAt:now+1,feature:'invitations' as const}
    assert.equal(commentWaitReason(config,[other],monitor,now),'automation_comments_yielding')
    assert.equal(commentWaitReason(config,[{...other,account:8}],monitor,now),undefined)
  }
  assert.equal(commentWaitReason(config,[{...post,feature:'invitations',state:'planned',plannedAt:now+1,closesAt:now+10}],monitor,now),undefined)
  assert.equal(commentWaitReason(config,[post],monitor,now),undefined)
})
