import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileInvitations } from '../pending.ts'
import { fixture } from './fixtures.ts'
import { invitationCandidate, invitationRun, invitationRuntime } from './invitation-test-fixtures.ts'
import { runRow, runFromRow } from '../store-rows.ts'

test('six hours with SQL roundtrips stops one unknown recovery 20 minutes after its first 500', async t => {
  const f = fixture(); let run = invitationRun(), now = Date.parse(run.createdAt), lists = 0, profiles = 0
  const start = now, item = { ...invitationCandidate(run, 'unknown'), status: 'uncertain' as const, sentAt: run.createdAt }
  await f.store.claimHistory(item)
  f.adapter.listPendingInvitations = async (_account: string, cursor: unknown) => {
    lists++
    return cursor === 'third' ? { data: [] } : { data: [{ user_id: cursor === 'second' ? 'other-2' : 'other-1' }],
      next_cursor: cursor === 'second' ? 'third' : 'second' }
  }
  f.adapter.getProfile = async () => {
    if (++profiles % 2 === 0) throw Object.assign(Error('unavailable'), { code: 'unipile_http_500', details: { httpStatus: 500 } })
    return { network_distance: 2 }
  }
  const runtime = invitationRuntime(f, { now: () => new Date(now), sleep: async () => { throw Error('must not sleep') } })
  for (let minute = 0; minute <= 360; minute++) {
    now = start + minute * 60_000
    run = runFromRow(runRow(run))
    await reconcileInvitations(runtime, run, async () => {}, { openHistory: [item] })
  }
  assert.equal(profiles, 2); assert.equal(lists, 6)
  assert.equal(run.searchProgress.invitationVerification, undefined)
  assert.equal(run.searchProgress.actionRecovery!['invite:unknown'].firstFailedAt, start + 15 * 60_000)
  assert.equal(run.searchProgress.actionRecovery!['invite:unknown'].skippedAt, start + 35 * 60_000)
  assert.equal(item.status, 'uncertain'); assert.equal(item.reasonCode, 'unipile_action_skipped')
  assert.equal(f.metrics.sends, 0)
  t.diagnostic(`six hours: ${profiles} passes, ${lists + profiles} GETs, 0 repeated POSTs`)
})

test('unknown verification preserves its backoff before 500 and then expires at the recovery deadline', async () => {
  const f = fixture(); let run = invitationRun(), now = Date.parse(run.createdAt), lists = 0, profiles = 0
  const item = { ...invitationCandidate(run, 'unknown'), status: 'uncertain' as const, sentAt: run.createdAt }
  await f.store.claimHistory(item)
  f.adapter.listPendingInvitations = async () => { lists++; return { data: [] } }
  f.adapter.getProfile = async () => { profiles++; return { network_distance: 2 } }
  const runtime = invitationRuntime(f, { now: () => new Date(now), sleep: async () => { throw Error('must yield, not sleep') } })
  const save = async () => undefined
  const first = await reconcileInvitations(runtime, run, save, { openHistory: [item] })
  assert.equal(first.unresolved, 1); assert.equal(lists, 1); assert.equal(profiles, 1)
  const firstDeadline = Date.parse(run.nextActionAt!)
  assert.equal(firstDeadline - now, 15 * 60_000)
  for (let i = 0; i < 20; i++) {
    run = structuredClone(run); now += 1000
    await reconcileInvitations(runtime, run, save, { openHistory: [item] })
  }
  assert.equal(lists, 1); assert.equal(profiles, 1)
  now = firstDeadline
  f.adapter.getProfile = async () => { profiles++; throw Object.assign(Error('temporary'), { code: 'unipile_http_500', details: { httpStatus: 500 } }) }
  await reconcileInvitations(runtime, run, save, { openHistory: [item] })
  assert.equal(Date.parse(run.nextActionAt!) - now, 20 * 60_000)
  assert.equal(run.searchProgress.invitationVerification?.firstAttemptAt, item.sentAt)
  assert.equal(run.searchProgress.invitationVerification?.attempt, 2)
  // An early tick cannot create another pass or restart the recovery window.
  now += 60_000
  await reconcileInvitations(runtime, run, save, { openHistory: [item] })
  assert.equal(run.searchProgress.invitationVerification?.attempt, 2)
  now = firstDeadline + 20 * 60_000
  await reconcileInvitations(runtime, run, save, { openHistory: [item] })
  assert.equal(item.reasonCode, 'unipile_action_skipped')
  assert.equal(lists, 2, 'no fresh request after the action expires')
  assert.equal(profiles, 2); assert.equal(f.metrics.sends, 0)
})

test('a late receipt confirms once without another send, and Stop never reads a page', async () => {
  const f = fixture(), run = invitationRun(); let now = Date.parse(run.createdAt), stop = false, calls = 0
  const item = { ...invitationCandidate(run, 'unknown'), status: 'uncertain' as any, sentAt: run.createdAt }
  await f.store.claimHistory(item)
  f.adapter.listPendingInvitations = async () => { calls++; return { data: [{ user_id: item.personId }], total_count: 1 } }
  const runtime = invitationRuntime(f, { now: () => new Date(now), stopRequested: () => stop })
  stop = true
  await reconcileInvitations(runtime, run, async () => {}, { openHistory: [item], singlePass: true })
  assert.equal(calls, 0)
  stop = false
  await reconcileInvitations(runtime, run, async () => {}, { openHistory: [item] })
  assert.equal(item.status, 'sent'); assert.equal(run.searchProgress.invitationVerification, undefined)
  assert.equal(f.metrics.sends, 0)
})
