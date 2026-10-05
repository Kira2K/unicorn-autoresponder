import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectionSteps } from '../execution.ts'
import { fixture } from './fixtures.ts'
import { invitationRuntime, invitationRun, invitationCandidate, INVITATION_TEST_STARTED_AT } from './invitation-test-fixtures.ts'
import { createConnectionInviterService } from '../service.ts'

test('managed Stop preserves quota and checks only the unknown invitation at its saved deadline after restart', async () => {
  const f = fixture(), run = invitationRun(); let now = Date.parse(run.createdAt), reads = 0
  run.searchProgress.automationId = 'task'; run.dailyQuota = 5
  const item = { ...invitationCandidate(run, 'unknown'), status: 'uncertain' as const, sentAt: run.createdAt }
  await f.store.createRun(run); await f.store.claimHistory(item)
  f.adapter.listPendingInvitations = async () => { reads++; return { data: [{ user_id: item.personId }], total_count: 1 } }
  const create = () => createConnectionInviterService({ ...f, now: () => new Date(now), autoRecover: false,
    enforceWriterSingleton: false, sleep: async () => { throw Error('must return its deadline') } })
  let service = create()
  try {
    const stopped = await service.stepManaged(run.runId, true)
    assert.equal(stopped.status, 'verifying'); assert.equal(reads, 0)
    service.stop(); service = create(); now = Date.parse(stopped.nextActionAt!) - 1
    assert.equal((await service.stepManaged(run.runId)).status, 'verifying'); assert.equal(reads, 0)
    now++; assert.equal((await service.stepManaged(run.runId)).status, 'stopped')
    assert.equal(reads, 1); assert.equal(f.metrics.sends, 0)
    const saved = (await f.store.getRun(run.runId))!
    assert.equal(saved.dailyQuota, 5); assert.equal(saved.counters.sent, 1)
    await service.stepManaged(run.runId); assert.equal(reads, 1)
    assert.equal((await f.store.getRun(run.runId))!.counters.sent, 1)
  } finally { service.stop() }
})

test('Stop preserves an unknown write without any provider read, including after restart', async () => {
  const f = fixture(), run = invitationRun()
  const item = { ...invitationCandidate(run, 'unknown'), status: 'uncertain' as const, sentAt: run.createdAt }
  await f.store.createRun(run); await f.store.claimHistory(item)
  let reads = 0
  f.adapter.listPendingInvitations = async () => { reads++; throw new Error('must not read after Stop') }
  const runtime = invitationRuntime(f, { stopRequested: () => true })
  let result
  for await (const step of connectionSteps(runtime, run, new Set(), async value => { await f.store.updateRun(value) })) result = step
  assert.equal(reads, 0); assert.equal(result?.status, 'stopped')
  assert.equal((await f.store.listRunHistory(run.runId, 1000))[0].status, 'uncertain')
  assert.equal((await f.store.getRun(run.runId))?.status, 'stopped')
})

for (const cooperating of [false, true]) test(`busy account preserves the completed history step (cooperate=${cooperating})`, async () => {
  const f = fixture({ stack: 'GO', connectionCount: 149 }), run = invitationRun()
  for (const { city } of await f.store.listCatalog()) run.searchProgress.locations[city] = {
    status: 'resolved', city, id: `location-${city}`, resolvedAt: INVITATION_TEST_STARTED_AT.toISOString()
  }
  await f.store.createRun(run)
  let busy = false, held = false, accountReads = 0, waits = 0
  let now = INVITATION_TEST_STARTED_AT.getTime()
  const read = f.adapter.getAccount
  f.adapter.getAccount = async (...args: any[]) => { accountReads++; return read(...args) }
  const runtime = { ...invitationRuntime(f, { now: () => new Date(now), sleep: async ms => { now += ms } }),
    cooperative: true, ...(cooperating ? { async cooperate<T>(action: () => Promise<T>) {
      assert.equal(held, false); waits++; busy = false; return action()
    } } : {}), gate: { acquire() {
      if (busy) throw Object.assign(new Error('busy'), { code: 'linkedin_operation_active' })
      assert.equal(held, false); held = true; return () => { held = false }
    } } }
  const steps = connectionSteps(runtime, run, new Set(), async value => { await f.store.updateRun(value) })
  assert.equal((await steps.next()).value?.reason, 'history_and_quota_saved')
  const readsAfterHistory = accountReads
  busy = true
  if (!cooperating) {
    for (let i = 0; i < 2; i++) {
      const waiting = await steps.next()
      assert.equal(waiting.done, false); assert.equal(waiting.value?.status, 'waiting')
      assert.equal(held, false); now = Date.parse(run.nextActionAt!)
    }
    busy = false
  }
  assert.equal((await steps.next()).value?.reason, 'candidate_page_saved')
  assert.equal(accountReads, readsAfterHistory, 'history/account verification is not restarted')
  assert.equal(f.metrics.sends, 0); assert.equal(held, false)
  if (cooperating) assert.ok(waits)
  await steps.return(undefined)
})

test('safe yields release the account and restart keeps candidates, run and remaining quota', async () => {
  const f = fixture({ stack: 'GO', connectionCount: 149 }), run = invitationRun()
  await f.store.createRun(run)
  let held = false
  const runtime = { ...invitationRuntime(f), gate: { acquire() {
    assert.equal(held, false); held = true; return () => held = false
  } } }
  const save = async (value: typeof run) => { await f.store.updateRun(value) }
  const steps = connectionSteps(runtime, run, new Set(), save)
  for (let i = 0; i < 20; i++) {
    const next = await steps.next(); assert.equal(held, false)
    assert.equal(next.done, false)
    if (next.value?.reason === 'candidate_result_saved' && run.counters.sent) break
  }
  assert.equal(run.counters.sent, 1)
  const snapshot = await f.store.getRun(run.runId)
  assert.ok(snapshot); assert.equal(snapshot.counters.sent, 1)
  await steps.return(undefined)
  for await (const _step of connectionSteps(runtime, snapshot, new Set(), save)) assert.equal(held, false)
  assert.equal(snapshot.runId, run.runId); assert.equal(snapshot.counters.sent, snapshot.dailyQuota)
  const history = await f.store.listRunHistory(run.runId, 1000)
  const sent = history.filter(item => item.status === 'sent')
  assert.equal(new Set(sent.map(item => item.personId)).size, sent.length)
  assert.equal(f.metrics.sends, snapshot.dailyQuota)
})

test('failed safe-point save does not allow the next external POST', async () => {
  const f = fixture({ stack: 'GO', connectionCount: 149 }), run = invitationRun()
  await f.store.createRun(run)
  let persisted = 0
  const save = async (value: typeof run, _event?: unknown, mode?: string) => {
    if (mode === 'critical') { persisted++; throw new Error('storage unavailable') }
    await f.store.updateRun(value)
  }
  const steps = connectionSteps(invitationRuntime(f), run, new Set(), save)
  await assert.rejects(steps.next())
  assert.ok(persisted); assert.equal(f.metrics.sends, 0)
})

test('Stop between steps returns a stopped result after saving, without a new POST', async () => {
  const f = fixture({ stack: 'GO', connectionCount: 149 }), run = invitationRun()
  await f.store.createRun(run)
  let stop = false
  const steps = connectionSteps(invitationRuntime(f, { stopRequested: () => stop }), run,
    new Set(), async value => { await f.store.updateRun(value) })
  assert.equal((await steps.next()).value?.status, 'ready')
  stop = true
  let result
  for await (const step of steps) result = step
  assert.equal(result?.status, 'stopped')
  assert.equal((await f.store.getRun(run.runId))?.status, 'stopped')
  assert.equal(f.metrics.sends, 0)
})

test('Stop before any send completes even when another feature owns the account', async () => {
  const f = fixture({ stack: 'GO', connectionCount: 149 }), run = invitationRun()
  await f.store.createRun(run)
  const runtime = { ...invitationRuntime(f, { stopRequested: () => true }),
    gate: { acquire() { throw new Error('must not acquire for local Stop') } } }
  let result
  for await (const step of connectionSteps(runtime, run, new Set(), async value => { await f.store.updateRun(value) })) result = step
  assert.equal(result?.status, 'stopped')
  assert.equal(f.metrics.sends, 0)
  assert.equal((await f.store.getRun(run.runId))?.status, 'stopped')
})
