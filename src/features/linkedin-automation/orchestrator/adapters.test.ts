import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFeatureAdapters } from './adapters.ts'

test('invitation completion and deferred read-back preserve ownership and account exclusion', async () => {
  const now=Date.parse('2026-09-22T06:00:00Z')
  let lock:any
  let value:any={runId:'invitation-run',automationKey:'automation-run',status:'succeeded',stage:'completed'}
  const adapters=createFeatureAdapters({invitations:{get:async()=>value} as any,posts:{} as any,
    comments:{} as any,gate:{current:()=>lock},now:()=>now})
  const run:any={key:'automation-run',featureRunId:'invitation-run',account:105}
  assert.equal((await adapters.invitations.status(run))?.state,'completed')
  value={...value,status:'running',stage:'resolving_uncertain',nextActionAt:new Date(now+3600000).toISOString()}
  const deferred=await adapters.invitations.status(run)
  assert.equal(deferred?.state,'deferred');assert.equal(deferred?.nextActionAt,now+3600000)
  lock={kind:'connection_inviter',id:'invitation-run'};assert.equal((await adapters.invitations.status(run))?.state,'running')
  lock={kind:'comment_monitor',id:'comment-job'}
  assert.equal((await adapters.invitations.status(run))?.state,'deferred','Another feature owning the account cannot revive a deferred invitation.')
  lock=undefined;value.nextActionAt=new Date(now-1).toISOString()
  assert.equal((await adapters.invitations.status(run))?.state,'running')
  value.automationKey='manual-run';assert.equal((await adapters.invitations.status(run))?.owned,false)
})
