const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs') as typeof import('node:fs')
const { tmpdir } = require('node:os') as typeof import('node:os')
const { join } = require('node:path') as typeof import('node:path')
const { CONNECTION_WRITER_HEARTBEAT_MS, CONNECTION_WRITER_LEASE_MS,
  connectionWriterHeartbeatDue, connectionWriterLeaseAvailable,
  createConnectionInviterService } = require('../service.ts') as
  typeof import('../service.ts')
const { failedRunCanRetry } = require('../retry-policy.ts') as typeof import('../retry-policy.ts')
const { makeRun } = require('../run-model.ts') as typeof import('../run-model.ts')
const { acquireConnectionWriterLock } = require('../writer-lock.ts') as
  typeof import('../writer-lock.ts')
const { fixture, waitRun } = require('./fixtures.ts') as typeof import('./fixtures.ts')

const clock = () => new Date('2026-08-24T09:00:00Z')
async function waitStage(service: any, runId: string, stage: string) {
  for (let count = 0; count < 100; count += 1) {
    const run = await service.get(runId)
    if (run?.stage === stage) return run
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`Connection test run did not reach ${stage}.`)
}
async function waitGuardedStop(service: any, runId: string) {
  for (let count = 0; count < 100; count += 1) {
    const run = await service.get(runId)
    if (run?.stage === 'stop_requested' &&
      run.errorCode === 'connection_invitation_result_pending') return run
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Connection test run did not persist the guarded Stop state.')
}
async function uncertain() {
  const test = fixture({ stack: 'Frontend', sendFailure: Object.assign(new Error('timeout'),
    { code: 'unipile_timeout' }) })
  const originalSend = test.adapter.sendInvitation; let attemptedPersonId = ''
  const originalProfile = test.adapter.getProfile
  test.adapter.getProfile = async (accountId: string, personId: string) => ({
    ...(await originalProfile(accountId, personId)), relationship: 'not_connected'
  })
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    attemptedPersonId = personId; return originalSend(accountId, personId)
  }
  const waits: Array<() => void> = []
  const service = createConnectionInviterService({ ...test, now: clock,
    sleep: async () => test.metrics.sends
      ? new Promise<void>(resolve => waits.push(resolve)) : undefined })
  const started: any = await service.start(7)
  for (let count = 0; count < 100 && (!waits.length || test.metrics.sends !== 1); count += 1) {
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  assert.equal(test.metrics.sends, 1)
  assert.equal((await service.history(7)).some((item: any) => item.status === 'uncertain'), true)
  assert.equal((await service.get(started.runId))?.counters.sent, 0)
  await service.stopRun(started.runId); waits.shift()?.()
  const guarded: any = await waitGuardedStop(service, started.runId)
  assert.equal(guarded.status, 'running')
  assert.equal(guarded.errorCode, 'connection_invitation_result_pending')
  assert.equal(test.metrics.sends, 1)
  service.stop()
  test.adapter.listPendingInvitations = async (_accountId: string, offset = 0) =>
    ({ items: offset ? [] : [{ user_id: attemptedPersonId }] })
  const recoveryTime = new Date(Date.parse(guarded.nextActionAt) + 1)
  const recovered = createConnectionInviterService({ ...test, now: () => recoveryTime,
    autoRecover: false, sleep: async () => undefined })
  await recovered.recover()
  const stopped: any = await waitRun(recovered, started.runId)
  assert.equal(stopped.status, 'stopped'); assert.equal(stopped.stage, 'stopped_by_admin')
  assert.equal(stopped.counters.sent, 1); assert.equal(test.metrics.sends, 1)
}
async function serverErrorDoesNotRepeatPost() {
  const test = fixture({ stack: 'Frontend', sendFailure: Object.assign(new Error('unavailable'),
    { code: 'unipile_http_503', details: { httpStatus: 503 } }) })
  const waits: Array<() => void> = []
  const service = createConnectionInviterService({ ...test, now: clock,
    sleep: async () => test.metrics.sends
      ? new Promise<void>(resolve => waits.push(resolve)) : undefined })
  const started: any = await service.start(7)
  for (let count = 0; count < 100 && (!waits.length || test.metrics.sends !== 1); count += 1) {
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  await service.stopRun(started.runId); waits.shift()?.()
  const guarded: any = await waitStage(service, started.runId, 'stop_requested')
  assert.equal(guarded.status, 'running'); assert.equal(test.metrics.sends, 1)
  service.stop()
}
async function missingReadbackDoesNotRepeatPost() {
  const test = fixture({ stack: 'Frontend' }); let posts = 0
  test.adapter.sendInvitation = async () => { posts += 1; return { request_id: 'missing' } }
  const waits: Array<() => void> = []
  const service = createConnectionInviterService({ ...test, now: clock,
    sleep: async () => posts ? new Promise<void>(resolve => waits.push(resolve)) : undefined })
  const started: any = await service.start(7)
  for (let count = 0; count < 100 && (!waits.length || posts !== 1); count += 1) {
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  await service.stopRun(started.runId); waits.shift()?.()
  const guarded: any = await waitStage(service, started.runId, 'stop_requested')
  assert.equal(guarded.status, 'running'); assert.equal(posts, 1)
  service.stop()
}
async function missingStack() {
  const test = fixture({}); const service = createConnectionInviterService({ ...test, now: clock,
    sleep: async () => undefined })
  const paused: any = await service.start(7)
  assert.equal(paused.status, 'paused'); assert.equal(paused.stage, 'stack_required')
  assert.equal(test.metrics.reads, 0); assert.equal(test.metrics.sends, 0)
  const resumed: any = await service.start(7, { safeRecruiterOnly: true })
  const completed: any = await waitRun(service, resumed.runId)
  assert.equal(completed.status, 'partial'); assert.equal(completed.audienceQuota.technical, 3)
  assert.equal(completed.counters.shortfallByAudience.technical, 3)
  assert.equal((await service.history(7)).filter((item: any) => item.status === 'sent')
    .every((item: any) => item.audience === 'recruiter'), true)
}
async function weekendRun() {
  const test = fixture({ stack: 'Frontend' })
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), sleep: async () => undefined })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.dailyQuota, 11)
}
async function safeFailedRetry() {
  const test = fixture({ stack: 'Frontend' }); const readProfile = test.adapter.getOwnProfile
  let first = true
  test.adapter.getOwnProfile = async () => {
    if (first) { first = false; throw new Error('temporary read failure') }
    return readProfile()
  }
  const service = createConnectionInviterService({ ...test, now: clock, sleep: async () => undefined })
  const initial: any = await service.start(7); const failed: any = await waitRun(service, initial.runId)
  assert.equal(failed.status, 'failed'); assert.equal(test.metrics.sends, 0)
  const retried: any = await service.start(7); const completed: any = await waitRun(service, retried.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.searched > 0, true)
  assert.equal(test.metrics.sends, 11)
}
async function safeHistoryRetry() {
  const timeout = Object.assign(new Error('timeout'), { code: 'unipile_timeout' })
  const test = fixture({ stack: 'Frontend', pendingReadFailure: timeout, stablePeople: true })
  const service = createConnectionInviterService({ ...test, now: clock, sleep: async () => undefined })
  const initial: any = await service.start(7)
  const completed: any = await waitRun(service, initial.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(test.metrics.sends, 11)
}
async function stoppableRun() {
  const test = fixture({ stack: 'Frontend' }); const waits: Array<() => void> = []; const events: any[] = []
  const service = createConnectionInviterService({ ...test, now: clock, random: () => 0,
    sleep: async () => test.metrics.sends
      ? new Promise<void>(resolve => waits.push(resolve)) : undefined,
    logger: { event(stage: string, status: string) { events.push({ stage, status }) } } })
  const started: any = await service.start(7)
  for (let count = 0; count < 100 && (!waits.length || test.metrics.sends !== 1); count += 1) {
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  assert.equal(test.metrics.sends, 1); assert.equal(waits.length, 1)
  const requested: any = await service.stopRun(started.runId)
  assert.equal(requested.status, 'running'); assert.equal(requested.stage, 'stop_requested')
  waits.shift()!(); const stopped: any = await waitRun(service, started.runId)
  assert.equal(stopped.status, 'stopped'); assert.equal(stopped.stage, 'stopped_by_admin')
  assert.equal(test.metrics.sends, 1)
  assert.equal(events.some(event => event.stage === 'run_stop' && event.status === 'succeeded'), true)
}
async function stopPersistenceRetriesDespiteStopIntent() {
  const test = fixture({ stack: 'Frontend', connectionCount: 149 })
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test Client',
    linkedinUrl: 'https://www.linkedin.com/in/test/', accountId: 'acc_test', stack: 'Frontend' },
  clock(), 'Europe/Moscow', false)
  await test.store.createRun(run)
  const updateRun = test.store.updateRun.bind(test.store)
  let stopIntentFailures = 0; let terminalFailures = 0
  test.store.updateRun = async (next: any) => {
    if (next.stage === 'stop_requested' && stopIntentFailures === 0) {
      stopIntentFailures += 1
      throw Object.assign(new Error('stop intent rate limited'), {
        code: 'noco_rate_limited', details: { httpStatus: 429 }
      })
    }
    if (next.status === 'stopped' && terminalFailures === 0) {
      terminalFailures += 1
      throw Object.assign(new Error('terminal stop rate limited'), {
        code: 'noco_rate_limited', details: { httpStatus: 429 }
      })
    }
    return updateRun(next)
  }
  const service = createConnectionInviterService({ ...test, now: clock,
    autoRecover: false, random: () => 0, sleep: async () => undefined })
  const stopped: any = await service.stopRun(run.runId)
  assert.equal(stopped.status, 'stopped')
  assert.equal(stopped.stage, 'stopped_by_admin')
  assert.equal(stopIntentFailures, 1); assert.equal(terminalFailures, 1)
  assert.equal(test.metrics.sends, 0)
  await service.recover()
  const durable: any = await service.get(run.runId)
  assert.equal(durable.status, 'stopped'); assert.equal(test.metrics.sends, 0)
}
async function stopAfterClaimDoesNotReachProvider() {
  const test = fixture({ stack: 'Frontend', connectionCount: 149 })
  const originalClaim = test.store.claimHistory.bind(test.store)
  let releaseClaim!: () => void
  let claimStarted!: () => void
  const startedClaim = new Promise<void>(resolve => { claimStarted = resolve })
  const blockedClaim = new Promise<void>(resolve => { releaseClaim = resolve })
  test.store.claimHistory = async (item: any) => {
    const claimed = await originalClaim(item)
    claimStarted()
    await blockedClaim
    return claimed
  }
  const service = createConnectionInviterService({ ...test, now: clock,
    sleep: async () => undefined })
  const started: any = await service.start(7)
  await startedClaim
  await service.stopRun(started.runId)
  releaseClaim()
  const stopped: any = await waitRun(service, started.runId)
  assert.equal(stopped.status, 'stopped')
  assert.equal(test.metrics.sends, 0)
  const history: any[] = await service.history(7)
  assert.equal(history.some(item => ['sending', 'uncertain'].includes(item.status)), false)
  assert.equal(history.some(item => item.status === 'deferred' &&
    item.reasonCode === 'connection_stop_requested'), true)
}
async function stopInterruptsTransientPostClaimRead() {
  const test = fixture({ stack: 'Frontend', connectionCount: 149 })
  const originalClaim = test.store.claimHistory.bind(test.store)
  const originalProfile = test.adapter.getProfile
  let claimed = false; let failedFinalRead = false; let releaseWait!: () => void
  test.store.claimHistory = async (item: any) => {
    const result = await originalClaim(item); if (result) claimed = true; return result
  }
  test.adapter.getProfile = async (accountId: string, personId: string) => {
    if (claimed && !failedFinalRead) {
      failedFinalRead = true
      throw Object.assign(new Error('post-claim profile read unavailable'), {
        code: 'unipile_http_503', details: { httpStatus: 503 }
      })
    }
    return originalProfile(accountId, personId)
  }
  const service = createConnectionInviterService({ ...test, now: clock,
    sleep: async () => failedFinalRead
      ? new Promise<void>(resolve => { releaseWait = resolve }) : undefined })
  const started: any = await service.start(7)
  for (let count = 0; count < 100 && !releaseWait; count += 1) {
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  assert.equal(failedFinalRead, true)
  const stopStartedAt = Date.now()
  await service.stopRun(started.runId)
  releaseWait()
  const stopped: any = await waitRun(service, started.runId)
  assert.equal(Date.now() - stopStartedAt < 1_000, true)
  assert.equal(stopped.status, 'stopped')
  assert.equal(test.metrics.sends, 0)
  const history: any[] = await service.history(7)
  assert.equal(history.some(item => ['sending', 'uncertain'].includes(item.status)), false)
}
async function preWriteRetryStopsAtMidnight() {
  const test = fixture({ stack: 'Frontend', connectionCount: 149 })
  let now = Date.parse('2026-08-24T20:59:59.500Z'); let failed = false
  const originalPending = test.adapter.listPendingInvitations
  test.adapter.listPendingInvitations = async (accountId: string, page: number | string = 0) => {
    if (!failed) {
      failed = true
      throw Object.assign(new Error('pre-write pending unavailable'), {
        code: 'unipile_http_503', details: { httpStatus: 503 }
      })
    }
    return originalPending(accountId, typeof page === 'number' ? page : 0)
  }
  const service = createConnectionInviterService({ ...test, now: () => new Date(now),
    random: () => 0, sleep: async milliseconds => { now += milliseconds } })
  const started: any = await service.start(7)
  const closed: any = await waitRun(service, started.runId)
  assert.equal(closed.status, 'partial')
  assert.equal(closed.stage, 'daily_window_closed')
  assert.equal(test.metrics.sends, 0)
}
async function postWriteRetrySurvivesMidnightUntilReadback() {
  const test = fixture({ stack: 'Frontend', connectionCount: 149 })
  let now = Date.parse('2026-08-24T20:59:59.500Z'); let posts = 0
  let allowReadback = false; let releaseWait!: () => void
  const originalSend = test.adapter.sendInvitation
  const originalPending = test.adapter.listPendingInvitations
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    posts += 1; return originalSend(accountId, personId)
  }
  test.adapter.listPendingInvitations = async (accountId: string, page: number | string = 0) => {
    if (posts > 0 && !allowReadback) {
      throw Object.assign(new Error('post-write pending unavailable'), {
        code: 'unipile_http_503', details: { httpStatus: 503 }
      })
    }
    return originalPending(accountId, typeof page === 'number' ? page : 0)
  }
  const service = createConnectionInviterService({ ...test, now: () => new Date(now),
    random: () => 0, sleep: async milliseconds => {
      if (posts > 0 && !allowReadback) {
        now += milliseconds
        await new Promise<void>(resolve => { releaseWait = resolve })
      }
    } })
  const started: any = await service.start(7)
  for (let count = 0; count < 100 && !releaseWait; count += 1) {
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  const guarded: any = await service.get(started.runId)
  assert.equal(guarded.status, 'running')
  assert.equal(guarded.stage, 'waiting_retry')
  assert.equal(posts, 1)
  allowReadback = true; releaseWait()
  const closed: any = await waitRun(service, started.runId)
  assert.equal(closed.status, 'partial')
  assert.equal(closed.stage, 'daily_window_closed')
  assert.equal(closed.counters.sent, 1)
  assert.equal(posts, 1)
}
async function orphanedRunStop() {
  const test = fixture({ stack: 'Frontend' })
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test Client',
    linkedinUrl: 'https://www.linkedin.com/in/test/', accountId: 'acc_test', stack: 'Frontend' },
  clock(), 'Europe/Moscow', false)
  await test.store.createRun(run)
  await test.store.claimHistory({ historyKey: 'acc_test:orphan-sending', runId: run.runId,
    platformAccountId: 7, accountId: 'acc_test', personId: 'orphan-sending',
    audience: 'recruiter', searchKey: 'orphan', name: 'Orphan', headline: 'Recruiter',
    location: 'Berlin', status: 'sending', reasonCode: 'invitation_claimed',
    discoveredAt: clock().toISOString(), updatedAt: clock().toISOString() })
  test.adapter.listPendingInvitations = async (_accountId: string, offset = 0) =>
    ({ items: offset ? [] : [{ user_id: 'orphan-sending' }] })
  const service = createConnectionInviterService({ ...test, now: clock, autoRecover: false })
  const stopped: any = await service.stopRun(run.runId)
  assert.equal(stopped.status, 'stopped'); assert.equal(stopped.stage, 'stopped_by_admin')
  const history: any[] = await service.history(7)
  assert.equal(history[0].status, 'sent')
  assert.equal(test.metrics.sends, 0)
}
async function orphanedStopDoesNotWaitThroughProviderBackoff() {
  const test = fixture({ stack: 'Frontend' })
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test Client',
    linkedinUrl: 'https://www.linkedin.com/in/test/', accountId: 'acc_test', stack: 'Frontend' },
  clock(), 'Europe/Moscow', false)
  await test.store.createRun(run)
  await test.store.claimHistory({ historyKey: 'acc_test:orphan-backoff', runId: run.runId,
    platformAccountId: 7, accountId: 'acc_test', personId: 'orphan-backoff',
    audience: 'recruiter', searchKey: 'orphan', name: 'Orphan', headline: 'Recruiter',
    location: 'Berlin', status: 'sending', reasonCode: 'invitation_claimed',
    discoveredAt: clock().toISOString(), updatedAt: clock().toISOString() })
  let pendingCalls = 0
  test.adapter.listPendingInvitations = async () => {
    pendingCalls += 1
    throw Object.assign(new Error('rate limited'), {
      code: 'unipile_api_too_many_requests',
      details: { httpStatus: 429, retryAfterMs: 3_600_000 }
    })
  }
  let slept = false
  const service = createConnectionInviterService({ ...test, now: clock, autoRecover: false,
    sleep: async () => { slept = true } })
  const stopped: any = await service.stopRun(run.runId)
  assert.equal(stopped.status, 'running')
  assert.equal(stopped.stage, 'stop_requested')
  assert.equal(slept, false)
  assert.equal(pendingCalls, 1)
  assert.equal(test.metrics.sends, 0)
  service.stop()
  const recovered = createConnectionInviterService({ ...test, now: clock, autoRecover: false,
    sleep: async () => { slept = true } })
  await recovered.recover()
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(pendingCalls, 1)
  assert.equal(slept, false)
  recovered.stop()
}
async function startCannotClearDurableStop() {
  const test = fixture({ stack: 'Frontend', connectionCount: 149 })
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test Client',
    linkedinUrl: 'https://www.linkedin.com/in/test/', accountId: 'acc_test', stack: 'Frontend' },
  clock(), 'Europe/Moscow', false)
  run.stage = 'stop_requested'
  await test.store.createRun(run)
  await test.store.claimHistory({ historyKey: 'acc_test:durable-stop-sending', runId: run.runId,
    platformAccountId: 7, accountId: 'acc_test', personId: 'durable-stop-sending',
    audience: 'recruiter', searchKey: 'durable-stop', name: 'Durable Stop', headline: 'Recruiter',
    location: 'Berlin', status: 'sending', reasonCode: 'invitation_claimed',
    discoveredAt: clock().toISOString(), updatedAt: clock().toISOString() })
  test.adapter.listPendingInvitations = async (_accountId: string, offset = 0) =>
    ({ items: offset ? [] : [{ user_id: 'durable-stop-sending' }] })
  const service = createConnectionInviterService({ ...test, now: clock,
    autoRecover: false, sleep: async () => undefined })
  await assert.rejects(service.start(7),
    (error: any) => error.code === 'connection_invitation_result_pending')
  assert.equal(test.metrics.sends, 0)
  await service.recover()
  const stopped: any = await waitRun(service, run.runId)
  assert.equal(stopped.status, 'stopped')
  assert.equal(stopped.counters.sent, 1)
  assert.equal(test.metrics.sends, 0)
}
async function successfulPostReadback429DoesNotRepeatPost() {
  const test = fixture({ stack: 'Frontend', connectionCount: 149 })
  const send = test.adapter.sendInvitation
  const listPending = test.adapter.listPendingInvitations
  let posts = 0; let pendingReads = 0
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    posts += 1
    return send(accountId, personId)
  }
  test.adapter.listPendingInvitations = async (accountId: string, offset = 0) => {
    pendingReads += 1
    if (pendingReads === 2) {
      throw Object.assign(new Error('readback rate limited'), {
        code: 'unipile_http_429', details: { httpStatus: 429 }
      })
    }
    return listPending(accountId, offset)
  }
  const service = createConnectionInviterService({ ...test, now: clock,
    sleep: async () => undefined })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded')
  assert.equal(posts, 5)
  assert.equal(test.metrics.sends, 5)
}

async function postReadbackFailurePersistsUncertainBeforeRetry() {
  const test = fixture({ stack: 'Frontend', connectionCount: 149 })
  const send = test.adapter.sendInvitation
  const listPending = test.adapter.listPendingInvitations
  let posts = 0; let pendingReads = 0; let releaseRetry!: () => void
  let retryWaiting = false
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    posts += 1
    return send(accountId, personId)
  }
  test.adapter.listPendingInvitations = async (accountId: string, offset = 0) => {
    pendingReads += 1
    if (pendingReads === 2) {
      throw Object.assign(new Error('readback unavailable'), {
        code: 'unipile_unreachable'
      })
    }
    return listPending(accountId, offset)
  }
  const service = createConnectionInviterService({ ...test, now: clock,
    sleep: async () => posts === 1 && pendingReads === 2
      ? new Promise<void>(resolve => { retryWaiting = true; releaseRetry = resolve })
      : undefined })
  const started: any = await service.start(7)
  for (let count = 0; count < 100 && !retryWaiting; count += 1) {
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  assert.equal(retryWaiting, true)
  assert.equal(posts, 1)
  assert.equal((await service.get(started.runId))?.counters.sent, 0)
  const waitingHistory: any[] = await service.history(7)
  assert.equal(waitingHistory.some(item => item.status === 'uncertain' &&
    item.reasonCode === 'unipile_unreachable'), true)
  releaseRetry()
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded')
  assert.equal(posts, 5)
}

async function providerRateLimitRecoversAndCompletesRun() {
  const test = fixture({ stack: 'Frontend', connectionCount: 149 })
  const originalSend = test.adapter.sendInvitation
  let postCalls = 0
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    postCalls += 1
    if (postCalls === 1) {
      throw Object.assign(new Error('LinkedIn rate limited'), {
        code: 'unipile_provider_too_many_requests', details: { httpStatus: 429 }
      })
    }
    return originalSend(accountId, personId)
  }
  const service = createConnectionInviterService({ ...test, now: clock,
    sleep: async () => undefined })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded')
  assert.equal(completed.stage, 'completed')
  assert.equal(completed.counters.sent, 5)
  assert.equal(postCalls, 6)
  assert.equal(test.metrics.sends, 5)
  const history: any[] = await service.history(7)
  assert.equal(history.filter(item => item.status === 'sent').length, 5)
  service.stop()
}

async function corruptConfirmedQuotaBlocksPosts() {
  const test = fixture({ stack: 'GO', connectionCount: 1663 })
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test Client',
    linkedinUrl: 'https://www.linkedin.com/in/test/', accountId: 'acc_test', stack: 'GO' },
  clock(), 'Europe/Moscow', false)
  run.dailyLimit = 40; run.dailyQuota = 40
  run.audienceQuota = { recruiter: 28, technical: 12 }
  await test.store.createRun(run)
  for (let index = 0; index < 41; index += 1) {
    const audience = index < 29 ? 'recruiter' : 'technical'
    await test.store.claimHistory({ historyKey: `acc_test:overflow-${index}`,
      runId: run.runId, platformAccountId: 7, accountId: 'acc_test',
      personId: `overflow-${index}`, audience, searchKey: 'overflow', name: `Overflow ${index}`,
      headline: audience === 'recruiter' ? 'Recruiter' : 'GO Engineer', location: 'Berlin',
      status: 'sent', reasonCode: 'pending_readback_confirmed', discoveredAt: clock().toISOString(),
      updatedAt: clock().toISOString(), sentAt: clock().toISOString(),
      verifiedAt: clock().toISOString() })
  }
  const service = createConnectionInviterService({ ...test, now: clock,
    autoRecover: false, sleep: async () => undefined })
  const started: any = await service.start(7)
  const failed: any = await waitRun(service, started.runId)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.errorCode, 'connection_daily_quota_exceeded')
  assert.equal(test.metrics.sends, 0)
}

async function readOnlyServiceRejectsMutations() {
  const test = fixture({ stack: 'Frontend' }); let runMutations = 0; let stackMutations = 0
  const updateRun = test.store.updateRun.bind(test.store)
  test.store.updateRun = async (run: any) => { runMutations += 1; return updateRun(run) }
  const updateStack = test.repository.updatePrimaryStack.bind(test.repository) as
    (clientId: number, stackId: number) => Promise<{ id: number; name: string }>
  ;(test.repository as any).updatePrimaryStack = async (clientId: number, stackId: number) => {
    stackMutations += 1; return updateStack(clientId, stackId)
  }
  const service = createConnectionInviterService({ ...test, writerEnabled: false,
    writerId: 'read-only', autoRecover: false })
  await assert.rejects(() => service.stopRun('missing'),
    (error: any) => error.code === 'connection_writer_disabled')
  await assert.rejects(() => service.saveStack(7, 10),
    (error: any) => error.code === 'connection_writer_disabled')
  assert.equal(runMutations, 0); assert.equal(stackMutations, 0)
}

assert.equal(CONNECTION_WRITER_HEARTBEAT_MS < CONNECTION_WRITER_LEASE_MS, true)
assert.equal(connectionWriterHeartbeatDue(clock().getTime() - CONNECTION_WRITER_HEARTBEAT_MS,
  clock().getTime()), true)
assert.equal(connectionWriterHeartbeatDue(clock().getTime() - CONNECTION_WRITER_HEARTBEAT_MS + 1,
  clock().getTime()), false)
assert.equal(connectionWriterLeaseAvailable({ executorId: 'one', heartbeatAt: clock().toISOString() } as any,
  'two', clock().getTime()), false)
assert.equal(connectionWriterLeaseAvailable({ executorId: 'one',
  heartbeatAt: new Date(clock().getTime() - CONNECTION_WRITER_LEASE_MS - 1).toISOString() } as any,
  'two', clock().getTime()), true)
const missingWriter = fixture({ stack: 'Frontend' })
assert.throws(() => createConnectionInviterService({ ...missingWriter, writerId: '' }),
  (error: any) => error.code === 'connection_writer_id_missing')
const settingsStore = fixture({ stack: 'Frontend' })
const settingsService = createConnectionInviterService({ ...settingsStore, autoRecover: false })
assert.deepEqual(settingsService.settings(), { writerEnabled: true })
const lockId = `connection-writer-test-${process.pid}-${Date.now()}`
const testLockPath = join(tmpdir(), `${lockId}.lock`)
const firstLock = acquireConnectionWriterLock(lockId, testLockPath)
assert.throws(() => acquireConnectionWriterLock(lockId, testLockPath),
  (error: any) => error.code === 'connection_writer_lock_active')
firstLock.release()
const replacementLock = acquireConnectionWriterLock(lockId, testLockPath)
assert.throws(() => firstLock.assertOwned(),
  (error: any) => error.code === 'connection_writer_fence_lost')
replacementLock.release()
const staleLockId = `${lockId}-stale`
const staleLockPath = join(tmpdir(), `${staleLockId}.lock`)
writeFileSync(staleLockPath, JSON.stringify({
  nonce: 'stale-owner', pid: 2_147_483_647, createdAt: clock().toISOString()
}), 'utf8')
const staleReplacement = acquireConnectionWriterLock(staleLockId, staleLockPath)
staleReplacement.assertOwned(); staleReplacement.release()
const fencedFixture = fixture({ stack: 'Frontend', connectionCount: 149 })
const fencedWriterId = `${lockId}-service`
const firstWriter = createConnectionInviterService({ ...fencedFixture, autoRecover: false,
  writerId: fencedWriterId, enforceWriterSingleton: true, writerLockPath: testLockPath })
assert.throws(() => createConnectionInviterService({ ...fencedFixture, autoRecover: false,
  writerId: fencedWriterId, enforceWriterSingleton: true, writerLockPath: testLockPath }),
  (error: any) => error.code === 'connection_writer_lock_active')
assert.throws(() => createConnectionInviterService({ ...fencedFixture, autoRecover: false,
  writerId: `${fencedWriterId}-different`, enforceWriterSingleton: true,
  writerLockPath: testLockPath }),
  (error: any) => error.code === 'connection_writer_lock_active')
firstWriter.stop()
const replacementWriter = createConnectionInviterService({ ...fencedFixture, autoRecover: false,
  writerId: fencedWriterId, enforceWriterSingleton: true, writerLockPath: testLockPath })
const fencedRestartAssertion = assert.rejects(firstWriter.start(7),
  (error: any) => error.code === 'connection_writer_service_stopped')
assert.equal(fencedFixture.metrics.sends, 0)
replacementWriter.stop()
const failedRun = { runId: 'run-1', status: 'failed', counters: { sent: 0 } } as any
assert.equal(failedRunCanRetry(failedRun, [{ runId: 'run-1', status: 'eligible' } as any]), true)
assert.equal(failedRunCanRetry(failedRun, [{ runId: 'run-1', status: 'skipped' } as any]), true)
assert.equal(failedRunCanRetry(failedRun, [{ runId: 'run-1', status: 'sending' } as any]), false)
assert.equal(failedRunCanRetry(failedRun, [{ runId: 'run-1', status: 'sent',
  sentAt: clock().toISOString(), requestId: 'confirmed' } as any]), true)
assert.equal(failedRunCanRetry(failedRun, [{ runId: 'run-1', status: 'uncertain',
  sentAt: clock().toISOString() } as any]), false)
assert.equal(failedRunCanRetry(failedRun, [{ runId: 'run-1', status: 'failed',
  sentAt: clock().toISOString() } as any]), false)
async function run() {
  await fencedRestartAssertion
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['uncertain', uncertain], ['serverError', serverErrorDoesNotRepeatPost],
    ['missingReadback', missingReadbackDoesNotRepeatPost],
    ['postReadback429', successfulPostReadback429DoesNotRepeatPost],
    ['postReadbackPersistsUncertain', postReadbackFailurePersistsUncertainBeforeRetry],
    ['providerCooldownRecovery', providerRateLimitRecoversAndCompletesRun],
    ['quotaOverflow', corruptConfirmedQuotaBlocksPosts],
    ['readOnly', readOnlyServiceRejectsMutations], ['missingStack', missingStack],
    ['weekend', weekendRun], ['safeRetry', safeFailedRetry], ['safeHistory', safeHistoryRetry],
    ['stop', stoppableRun], ['stopPersist', stopPersistenceRetriesDespiteStopIntent],
    ['stopClaim', stopAfterClaimDoesNotReachProvider],
    ['stopRead', stopInterruptsTransientPostClaimRead],
    ['preWriteDay', preWriteRetryStopsAtMidnight],
    ['postWriteDay', postWriteRetrySurvivesMidnightUntilReadback],
    ['orphanStop', orphanedRunStop],
    ['orphanStopBackoff', orphanedStopDoesNotWaitThroughProviderBackoff],
    ['durableStop', startCannotClearDurableStop]
  ]
  for (const [name, test] of cases) {
    console.log(`safety case: ${name}`); await test()
  }
}

run()
  .then(() => console.log('connection safety tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
