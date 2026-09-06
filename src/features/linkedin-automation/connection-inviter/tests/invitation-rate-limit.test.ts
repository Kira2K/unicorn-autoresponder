const assert = require('node:assert/strict')
const { createInvitationPublisher } = require('../publisher.ts') as typeof import('../publisher.ts')
const { fixture } = require('./fixtures.ts') as typeof import('./fixtures.ts')
const { invitationCandidate, invitationRun, invitationRuntime } =
  require('./invitation-test-fixtures.ts') as typeof import('./invitation-test-fixtures.ts')

const apiRateLimit = () => Object.assign(new Error('Unipile API rate limited'), {
  code: 'unipile_api_too_many_requests', details: { httpStatus: 429, retryAfterMs: 60_000 }
})

const providerRateLimit = () => Object.assign(new Error('LinkedIn provider rate limited'), {
  code: 'unipile_provider_too_many_requests', details: { httpStatus: 429 }
})

async function apiRateLimitRetriesAfterBackoff() {
  const test = fixture({ stack: 'GO', connectionCount: 1663 })
  const originalSend = test.adapter.sendInvitation
  let postCalls = 0; let sleptMs = 0
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    postCalls += 1
    if (postCalls === 1) throw apiRateLimit()
    return originalSend(accountId, personId)
  }
  const runtime = invitationRuntime(test, {
    sleep: async (milliseconds: number) => { sleptMs += milliseconds }
  })
  const run = invitationRun()
  const publisher = await createInvitationPublisher(runtime, run, async () => undefined)
  const result = await publisher.publish('recruiter',
    [invitationCandidate(run, 'api-rate-limited')], 1)
  assert.equal(result.sentCount, 1)
  assert.equal(postCalls, 2)
  assert.equal(sleptMs, 180_000)
  assert.equal(run.counters.sent, 1)
}

async function providerRateLimitRetriesAfterNegativeReadback() {
  const test = fixture({ stack: 'GO', connectionCount: 1663 })
  const originalSend = test.adapter.sendInvitation
  let postCalls = 0; let sleptMs = 0
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    postCalls += 1
    if (postCalls === 1) throw providerRateLimit()
    return originalSend(accountId, personId)
  }
  const runtime = invitationRuntime(test, {
    sleep: async (milliseconds: number) => { sleptMs += milliseconds }
  })
  const run = invitationRun()
  const publisher = await createInvitationPublisher(runtime, run, async () => undefined)
  const result = await publisher.publish('recruiter',
    [invitationCandidate(run, 'provider-rate-limited')], 1)
  const history = await test.store.listRunHistory(run.runId)
  assert.equal(result.sentCount, 1)
  assert.equal(postCalls, 2)
  assert.equal(sleptMs, 180_000)
  assert.equal(history[0].status, 'sent')
  assert.equal(run.counters.sent, 1)
}

async function readbackRetryDoesNotResetProviderBackoff() {
  const test = fixture({ stack: 'GO', connectionCount: 1663 })
  const originalSend = test.adapter.sendInvitation
  const originalPending = test.adapter.listPendingInvitations
  let postCalls = 0; let pendingCalls = 0
  const sleeps: number[] = []
  const writeRetries: Array<{ attempt: number; delayMs: number }> = []
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    postCalls += 1
    if (postCalls <= 2) throw providerRateLimit()
    return originalSend(accountId, personId)
  }
  test.adapter.listPendingInvitations = async (...args: any[]) => {
    pendingCalls += 1
    if (pendingCalls === 2) {
      throw Object.assign(new Error('Temporary pending read-back failure'), {
        code: 'unipile_unreachable', details: { httpStatus: 503 }
      })
    }
    return originalPending(...args)
  }
  const runtime = invitationRuntime(test, {
    sleep: async (milliseconds: number) => { sleeps.push(milliseconds) }
  })
  const run = invitationRun()
  const save = async (_run: unknown, event?: string) => {
    if (event === 'retry_scheduled' && run.retryState?.operation === 'invitation_write') {
      writeRetries.push({ attempt: run.retryState.attempt, delayMs: run.retryState.delayMs })
    }
  }
  const publisher = await createInvitationPublisher(runtime, run, save)
  const result = await publisher.publish('recruiter',
    [invitationCandidate(run, 'readback-retry-rate-limited')], 1)

  assert.equal(result.sentCount, 1)
  assert.equal(postCalls, 3)
  assert.deepEqual(writeRetries, [
    { attempt: 1, delayMs: 180_000 },
    { attempt: 2, delayMs: 360_000 }
  ])
  assert.equal(sleeps.reduce((total, milliseconds) => total + milliseconds, 0), 630_000)
  assert.equal(run.retryState, undefined)
  assert.equal(run.invitationRetryState, undefined)
}

async function apiBackoffStopsAtMidnight() {
  const test = fixture({ stack: 'GO', connectionCount: 1663 })
  const run = invitationRun()
  let nowMs = new Date('2026-08-24T20:59:59Z').getTime()
  let postCalls = 0; let pendingReads = 0
  const originalPending = test.adapter.listPendingInvitations
  test.adapter.listPendingInvitations = async (...args: any[]) => {
    pendingReads += 1; return originalPending(...args)
  }
  test.adapter.sendInvitation = async () => { postCalls += 1; throw apiRateLimit() }
  const runtime = invitationRuntime(test, {
    now: () => new Date(nowMs),
    sleep: async (milliseconds: number) => { nowMs += milliseconds }
  })
  const publisher = await createInvitationPublisher(runtime, run, async () => undefined)
  await assert.rejects(() => publisher.publish('recruiter',
    [invitationCandidate(run, 'midnight-rate-limit')], 1),
  (error: any) => error.code === 'connection_daily_window_closed')
  const history = await test.store.listRunHistory(run.runId)
  assert.equal(postCalls, 1)
  assert.equal(pendingReads, 1)
  assert.equal(history[0].status, 'deferred')
}

async function run() {
  await apiRateLimitRetriesAfterBackoff()
  await providerRateLimitRetriesAfterNegativeReadback()
  await readbackRetryDoesNotResetProviderBackoff()
  await apiBackoffStopsAtMidnight()
}

run().then(() => console.log('connection invitation rate-limit tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
