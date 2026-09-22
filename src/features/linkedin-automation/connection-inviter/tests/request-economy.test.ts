import assert from 'node:assert/strict'
import { readPendingInvitations } from '../pending-reader.ts'
import { createPendingSnapshotController, PENDING_SNAPSHOT_TTL_MS } from '../pending-snapshot.ts'
import { fixture } from './fixtures.ts'
import { invitationRuntime, invitationRun, INVITATION_TEST_STARTED_AT } from './invitation-test-fixtures.ts'

async function positiveReadAndNegativeProof() {
  const test = fixture(), calls: Array<number | string> = []
  const rows = Array.from({ length: 121 }, (_, i) => ({ user: { id: `person-${i}` } }))
  test.adapter.listPendingInvitations = async (_account: string, page: number) => {
    calls.push(page)
    return { data: rows.slice(page, page + 50), total_count: rows.length }
  }
  const runtime = invitationRuntime(test)
  const first = await readPendingInvitations(runtime, 'acc_test', 'person-0')
  assert.equal(first.complete, false); assert.equal(calls.length, 1)
  calls.length = 0
  assert.equal((await readPendingInvitations(runtime, 'acc_test', 'person-120')).complete, true)
  assert.equal(calls.length, 3, 'Do not assume recent invitations are on the first page.')
  calls.length = 0
  const absent = await readPendingInvitations(runtime, 'acc_test', 'absent')
  assert.equal(absent.complete, true); assert.equal(calls.length, 3)
  test.adapter.listPendingInvitations = async (_account: string, page: number) =>
    ({ data: page ? [] : rows.slice(0, 50), total_count: 121 })
  await assert.rejects(readPendingInvitations(runtime, 'acc_test', 'absent'),
    (error: any) => error.code === 'unipile_pending_pagination_invalid')
}

async function cacheAndRequestCount() {
  const test = fixture(), rows = Array.from({ length: 121 }, (_, i) => ({ user: { id: `old-${i}` } }))
  let now = INVITATION_TEST_STARTED_AT.getTime(), calls = 0, originalCalls = 3
  test.adapter.listPendingInvitations = async (_account: string, page: number) => {
    calls++
    return { data: rows.slice(page, page + 50), total_count: rows.length }
  }
  const runtime = invitationRuntime(test, { now: () => new Date(now) })
  const cache = await createPendingSnapshotController(runtime, invitationRun(), async () => undefined)
  assert.equal(calls, 3)
  const initialAge = cache.snapshot().refreshedAt
  for (let i = 0; i < 33; i++) {
    await cache.ensureFresh()
    rows.unshift({ user: { id: `new-${i}` } })
    assert.equal(await cache.findFresh(`new-${i}`), true)
    cache.add(`new-${i}`)
    assert.equal(cache.has(`new-${i}`), true)
    originalCalls += Math.ceil(rows.length / 50)
    if (i === 0) assert.equal(cache.snapshot().refreshedAt, initialAge)
    now += 90_000
  }
  assert.ok(calls < originalCalls * .60, `Expected at least 40% fewer reads: ${calls} vs ${originalCalls}`)
  console.log(JSON.stringify({ scenario: '33 confirmations, 121 existing invitations, 90-second intervals',
    before: originalCalls, after: calls }))
  const beforeExpiry = calls
  now += PENDING_SNAPSHOT_TTL_MS + 1
  await cache.ensureFresh()
  assert.equal(calls - beforeExpiry, 4, 'A partial confirmation must not keep a stale full cache alive.')
  cache.invalidate('unipile_unreachable')
  const beforeInvalid = calls
  await cache.ensureFresh(); assert.equal(calls - beforeInvalid, 4)
}

async function run() { await positiveReadAndNegativeProof(); await cacheAndRequestCount() }
run().then(() => console.log('connection request economy tests passed'))
  .catch(error => { console.error(error); process.exitCode = 1 })
