const assert = require('node:assert/strict')
const { createInvitationPublisher } = require('../publisher.ts') as typeof import('../publisher.ts')
const { fixture } = require('./fixtures.ts') as typeof import('./fixtures.ts')
const { invitationCandidate, invitationRun, invitationRuntime } =
  require('./invitation-test-fixtures.ts') as typeof import('./invitation-test-fixtures.ts')

async function run() {
  const test = fixture({ stack: 'GO', connectionCount: 1663 })
  let pendingCalls = 0
  let profileCalls = 0
  let postCalls = 0
  const listPending = test.adapter.listPendingInvitations
  const getProfile = test.adapter.getProfile
  const sendInvitation = test.adapter.sendInvitation
  test.adapter.listPendingInvitations = async (accountId: string, page: number | string = 0) => {
    pendingCalls += 1
    return listPending(accountId, page)
  }
  test.adapter.getProfile = async (accountId: string, personId: string) => {
    profileCalls += 1
    return getProfile(accountId, personId)
  }
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    postCalls += 1
    return sendInvitation(accountId, personId)
  }
  const runtime = invitationRuntime(test)
  const run = invitationRun()
  const publisher = await createInvitationPublisher(runtime, run, async () => undefined)
  const result = await publisher.publish('recruiter',
    [invitationCandidate(run, 'one'), invitationCandidate(run, 'two')], 2)
  assert.equal(result.sentCount, 2)
  assert.equal(postCalls, 2)
  assert.equal(profileCalls, 2)
  assert.equal(pendingCalls, 5,
    'Expected one initial scan and one two-page read-back per successful invitation.')
}

run().then(() => console.log('connection publisher efficiency tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
