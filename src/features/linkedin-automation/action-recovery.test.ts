import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordFailure, recoveryExpired, recoveryWakeAt, skipRecovery, ACTION_RECOVERY_MS } from './action-recovery.ts'
import { fixture } from './connection-inviter/tests/fixtures.ts'
import { invitationCandidate, invitationRun, invitationRuntime } from './connection-inviter/tests/invitation-test-fixtures.ts'
import { createInvitationPublisher } from './connection-inviter/publisher.ts'
import { reconcileInvitations } from './connection-inviter/pending.ts'
import { invitationCapacity, synchronizeConfirmedProgress } from './connection-inviter/daily-progress.ts'
import { discoverComments } from './comment-monitor/discovery.ts'
import { resolveAuthorContext } from './comment-monitor/author-context.ts'

test('logical action gets one durable 20 minute window; unrelated actions and 429 do not start it', () => {
  const error = { details: { httpStatus: 500, retryAt: 9_000_000 } }
  const first = recordFailure(undefined, error, 1000)!
  assert.equal(recoveryExpired(first, 1000 + ACTION_RECOVERY_MS - 1), false)
  const restored = recordFailure(JSON.parse(JSON.stringify(first)), error, 500_000)!
  assert.equal(restored.firstFailedAt, 1000)
  assert.equal(recoveryExpired(restored, 1000 + ACTION_RECOVERY_MS), true)
  assert.equal(recoveryWakeAt(restored, error.details.retryAt), 1000 + ACTION_RECOVERY_MS)
  assert.equal(error.details.retryAt, 9_000_000, 'waking to skip must not shorten provider cooldown')
  skipRecovery(restored, 1000 + ACTION_RECOVERY_MS)
  assert.equal(restored.skippedAt, 1000 + ACTION_RECOVERY_MS)
  assert.equal(recordFailure(undefined, { details: { httpStatus: 429 } }, 0), undefined)
  assert.equal(recordFailure(undefined, error, 600_000)!.firstFailedAt, 600_000)
  const modelFailure = recordFailure(undefined, { code: 'post_openai_error', httpStatus: 500 }, 1000)!
  assert.equal(modelFailure.source, 'OpenAI'); assert.equal(modelFailure.stage, 'text_generation')
})

test('500 before invitation POST skips only that candidate and sends the next one', async () => {
  const f = fixture({ stack: 'GO', confirmedReceipts: true }), run = invitationRun()
  let now = Date.parse(run.createdAt), failedReads = 0
  const runtime = invitationRuntime(f, { now: () => new Date(now), sleep: async ms => { now += ms } })
  const profile = f.adapter.getProfile
  f.adapter.getProfile = async (account: string, id: string) => {
    if (id === 'broken') { failedReads++; throw Object.assign(Error('server'), {
      code: 'unipile_http_500', details: { httpStatus: 500, retryAfterMs: 300_000 } }) }
    return profile(account, id)
  }
  const publisher = await createInvitationPublisher(runtime, run, async () => {})
  const skipped = await publisher.publish('recruiter', [invitationCandidate(run, 'broken')], 1)
  assert.deepEqual(skipped.processedPersonIds, ['broken'])
  assert.equal(skipped.sentCount, 0); assert.equal(f.metrics.sends, 0)
  assert.equal(failedReads, 4); assert.ok(run.searchProgress.actionRecovery!['invite:broken'].skippedAt)
  // One call is one saved candidate step; the driver then gives the next one a turn.
  const result = await publisher.publish('recruiter', [invitationCandidate(run, 'next')], 1)
  assert.equal(result.sentCount, 1); assert.equal(f.metrics.sends, 1)
  assert.equal(failedReads, 4, 'the skipped candidate must not be read again')
  const history = await f.store.listRunHistory(run.runId, 1000)
  assert.equal(history.find(item => item.personId === 'broken')?.status, 'failed')
})

test('500 unknown invitation is skipped after restart without dropping its reservation or claiming success', async () => {
  const f = fixture({ stack: 'GO' }), run = invitationRun()
  let now = Date.parse(run.createdAt)
  const runtime = invitationRuntime(f, { now: () => new Date(now) })
  const publisher = await createInvitationPublisher(runtime, run, async () => {})
  f.adapter.sendInvitation = async () => { throw Object.assign(Error('server'), {
    code: 'unipile_http_500', details: { httpStatus: 500, retryAfterMs: 300_000 } }) }
  await publisher.publish('recruiter', [invitationCandidate(run, 'unknown')], 1)
  const restored = structuredClone(run)
  now += ACTION_RECOVERY_MS
  let reads = 0
  f.adapter.listPendingInvitations = async () => { reads++; throw Error('expired action must not read') }
  const result = await reconcileInvitations(runtime, restored, async () => {}, { runOnly: true, singlePass: true })
  assert.equal(result.unresolved, 0); assert.equal(reads, 0)
  const history = await f.store.listRunHistory(run.runId, 1000)
  assert.equal(history[0].status, 'uncertain'); assert.equal(history[0].reasonCode, 'unipile_action_skipped')
  synchronizeConfirmedProgress(restored, history)
  assert.equal(restored.counters.sent, 0)
  assert.equal(Object.keys(restored.searchProgress.reservedInvitations!).length, 1)
  assert.equal(invitationCapacity(restored).used.recruiter, 1)
})

test('one unreadable comment thread is skipped after restart without hiding another thread', async () => {
  let now = 1000, badReads = 0
  const job: any = { accountId: 'a', state: { posts: [{ id: 'p', text: 'Post' }], items: [], knownIds: [], discovered: 0 } }
  const adapter = { listComments: async () => ({ data: [
    { id: 'bad', text: 'Question', reply_counter: 1 }, { id: 'good', text: 'Another question', reply_counter: 0 }] }),
  listReplies: async () => { badReads++; throw Object.assign(Error('server'), { code: 'unipile_http_500', details: { httpStatus: 500 } }) } }
  const options = { job, adapter, logger: { event() {} }, now: () => now }
  await assert.rejects(discoverComments(options))
  const restored = structuredClone(job); now += ACTION_RECOVERY_MS
  const found = await discoverComments({ ...options, job: restored })
  assert.deepEqual(found.map(item => item.incomingId), ['good']); assert.equal(badReads, 1)
  assert.equal(restored.state.readRecovery['["p","bad"]'].skippedAt, now)
})

test('optional author context stops its 500 retries after 20 minutes and keeps the established neutral fallback', async () => {
  let now = 1000, calls = 0
  const job: any = { accountId: 'a', status: 'checking', state: {} }, logger = { event() {} }
  const options = { job, now: () => now, logger, save: async () => {}, adapter: { async getOwnProfile() {
    calls++; throw Object.assign(Error('server'), { code: 'unipile_http_500', details: { httpStatus: 500 } })
  } } }
  await assert.rejects(resolveAuthorContext(options))
  now += ACTION_RECOVERY_MS
  const restored = structuredClone(job)
  assert.deepEqual(await resolveAuthorContext({ ...options, job: restored }), {})
  assert.equal(calls, 1); assert.equal(restored.state.readRecovery.author_context.skippedAt, now)
})
