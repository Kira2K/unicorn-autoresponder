const assert = require('node:assert/strict')
const { createInvitationPublisher } = require('../publisher.ts') as typeof import('../publisher.ts')
const { createPendingSnapshotController, PENDING_SNAPSHOT_TTL_MS } =
  require('../pending-snapshot.ts') as typeof import('../pending-snapshot.ts')
const { fixture } = require('./fixtures.ts') as typeof import('./fixtures.ts')
const { invitationCandidate, invitationRun, invitationRuntime, INVITATION_TEST_STARTED_AT } =
  require('./invitation-test-fixtures.ts') as typeof import('./invitation-test-fixtures.ts')

async function lifetimeBoundary() {
  const test = fixture({ stack: 'GO', connectionCount: 1663 })
  let now = INVITATION_TEST_STARTED_AT.getTime()
  let pendingCalls = 0
  const listPending = test.adapter.listPendingInvitations
  test.adapter.listPendingInvitations = async (accountId: string, page: number | string = 0) => {
    pendingCalls += 1
    return listPending(accountId, page)
  }
  const runtime = invitationRuntime(test, { now: () => new Date(now) })
  const pending = await createPendingSnapshotController(runtime, invitationRun(), async () => undefined)
  assert.equal(pendingCalls, 1)
  now += PENDING_SNAPSHOT_TTL_MS
  await pending.ensureFresh(); assert.equal(pendingCalls, 1)
  now += 1
  await pending.ensureFresh(); assert.equal(pendingCalls, 2)
}

async function staleSnapshotRefreshesBeforePost() {
  const test = fixture({ stack: 'GO', connectionCount: 1663 })
  let now = INVITATION_TEST_STARTED_AT.getTime()
  let pendingCalls = 0
  const listPending = test.adapter.listPendingInvitations
  test.adapter.listPendingInvitations = async (accountId: string, page: number | string = 0) => {
    pendingCalls += 1
    return listPending(accountId, page)
  }
  const runtime = invitationRuntime(test, { now: () => new Date(now) })
  const run = invitationRun()
  const publisher = await createInvitationPublisher(runtime, run, async () => undefined)
  now += PENDING_SNAPSHOT_TTL_MS + 1
  const result = await publisher.publish('recruiter', [invitationCandidate(run, 'stale')], 1)
  assert.equal(result.sentCount, 1)
  assert.equal(pendingCalls, 4,
    'Expected initial scan, stale refresh and a two-page mandatory read-back.')
}

Promise.all([lifetimeBoundary(), staleSnapshotRefreshesBeforePost()])
  .then(() => console.log('connection pending snapshot tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
