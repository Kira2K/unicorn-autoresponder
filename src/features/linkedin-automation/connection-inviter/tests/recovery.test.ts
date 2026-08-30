const assert = require('node:assert/strict')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
const { makeRun } = require('../run-model.ts') as typeof import('../run-model.ts')
const { fixture, waitRun } = require('./fixtures.ts') as typeof import('./fixtures.ts')

const now = new Date('2026-08-29T09:00:00Z')

async function timerRecovery() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test',
    linkedinUrl: 'https://www.linkedin.com/in/test-client/', accountId: 'acc_test',
    stackId: 10, stack: 'GO' }, now, 'Europe/Moscow', false)
  run.stage = 'waiting_retry'; run.nextActionAt = new Date(now.getTime() + 90_000).toISOString()
  run.retryState = { provider: 'unipile', operation: 'people_search', attempt: 1,
    errorCode: 'unipile_http_429', delayMs: 90_000, nextRetryAt: run.nextActionAt,
    firstFailedAt: now.toISOString(), lastFailedAt: now.toISOString() }
  run.timerState = { kind: 'overload_backoff', delayMs: 90_000, nextActionAt: run.nextActionAt }
  await test.store.createRun(run)
  let slept = 0
  const service = createConnectionInviterService({ ...test, now: () => now, autoRecover: false,
    random: () => 0, sleep: async (milliseconds: number) => { slept += milliseconds } })
  await service.recover()
  const completed: any = await waitRun(service, run.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.sent, 5)
  assert.equal(slept >= 90_000, true)
}

async function sendingRecovery() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test',
    linkedinUrl: 'https://www.linkedin.com/in/test-client/', accountId: 'acc_test',
    stackId: 10, stack: 'GO' }, now, 'Europe/Moscow', false)
  run.stage = 'sending'; await test.store.createRun(run)
  const pending: string[] = []
  for (let index = 0; index < 5; index += 1) {
    const personId = `pending-${index}`; pending.push(personId)
    await test.store.claimHistory({ historyKey: `acc_test:${personId}`, runId: run.runId,
      platformAccountId: 7, accountId: 'acc_test', personId,
      audience: index < 4 ? 'recruiter' : 'technical', searchKey: 'recovery',
      name: `Person ${index}`, headline: 'Engineer', location: 'Berlin', status: 'sending',
      reasonCode: 'invitation_claimed', discoveredAt: now.toISOString(), updatedAt: now.toISOString() })
  }
  test.adapter.listPendingInvitations = async (_accountId: string, offset = 0) =>
    ({ items: pending.slice(offset).map(user_id => ({ user_id })) })
  const service = createConnectionInviterService({ ...test, now: () => now,
    autoRecover: false, sleep: async () => undefined })
  await service.recover()
  const completed: any = await waitRun(service, run.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.sent, 5)
  assert.equal(test.metrics.sends, 0)
}

async function secondWriter() {
  const test = fixture({ stack: 'GO' })
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test',
    linkedinUrl: 'https://www.linkedin.com/in/test-client/', accountId: 'acc_test',
    stackId: 10, stack: 'GO' }, now, 'Europe/Moscow', false)
  run.executorId = 'writer-one'; run.heartbeatAt = now.toISOString(); await test.store.createRun(run)
  const service = createConnectionInviterService({ ...test, now: () => now, autoRecover: false,
    writerId: 'writer-two' })
  await service.recover(); await new Promise(resolve => setTimeout(resolve, 10))
  const untouched: any = await service.get(run.runId)
  assert.equal(untouched.executorId, 'writer-one'); assert.equal(test.metrics.sends, 0)
}

async function waitsForHigherPriorityGate() {
  const test = fixture({ stack: 'GO', connectionCount: 149 }); let attempts = 0
  const service = createConnectionInviterService({ ...test, now: () => now,
    autoRecover: false, random: () => 0, sleep: async () => undefined,
    gate: { acquire() {
      attempts += 1
      if (attempts < 3) throw Object.assign(new Error('busy'), { code: 'linkedin_operation_active' })
      return () => undefined
    } } })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(attempts, 3)
}

async function queuedCandidatesSurviveRestart() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  test.store.listCatalog = async () => [
    { sourceKey: 'recruiter-test', audience: 'recruiter', city: 'Berlin',
      keywordTemplate: 'Recruiter Berlin', priority: 1, enabled: true },
    { sourceKey: 'technical-test', audience: 'technical', city: 'Berlin',
      keywordTemplate: '{stack} Engineer Berlin', priority: 2, enabled: true }
  ]
  test.adapter.searchPeople = async () => ({ items: [] })
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test',
    linkedinUrl: 'https://www.linkedin.com/in/test-client/', accountId: 'acc_test',
    stackId: 10, stack: 'GO' }, now, 'Europe/Moscow', false)
  run.stage = 'sending'
  run.searchProgress.pendingCandidates.push({ historyKey: 'acc_test:queued-person',
    runId: run.runId, platformAccountId: 7, accountId: 'acc_test', personId: 'queued-person',
    audience: 'recruiter', searchKey: 'recruiter-test', name: 'Queued Person',
    headline: 'Technical Recruiter', location: 'Berlin', status: 'eligible',
    reasonCode: 'candidate_eligible', discoveredAt: now.toISOString(), updatedAt: now.toISOString() })
  await test.store.createRun(run)
  const service = createConnectionInviterService({ ...test, now: () => now,
    autoRecover: false, sleep: async () => undefined })
  await service.recover()
  const failed: any = await waitRun(service, run.runId)
  assert.equal(failed.status, 'partial'); assert.equal(failed.stage, 'search_exhausted')
  assert.equal(failed.counters.sent, 1)
  assert.equal(failed.errorCode, 'connection_search_space_exhausted')
  assert.equal(test.metrics.sends, 1)
}

async function staleRunClosesWithoutCarryover() {
  const test = fixture({ stack: 'GO', connectionCount: 1663 })
  const old = new Date('2026-08-28T09:00:00Z')
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test',
    linkedinUrl: 'https://www.linkedin.com/in/test-client/', accountId: 'acc_test',
    stackId: 10, stack: 'GO' }, old, 'Europe/Moscow', false)
  run.counters.sent = 13; run.counters.sentByAudience = { recruiter: 9, technical: 4 }
  run.dailyQuota = 40; run.audienceQuota = { recruiter: 28, technical: 12 }
  run.stage = 'waiting_retry'
  await test.store.createRun(run)
  const service = createConnectionInviterService({ ...test, now: () => now, autoRecover: false })
  await service.recover()
  const closed: any = await service.get(run.runId)
  assert.equal(closed.status, 'partial', JSON.stringify(closed))
  assert.equal(closed.stage, 'daily_window_closed')
  assert.equal(closed.counters.sent, 13); assert.equal(closed.dailyQuota, 40)
  assert.equal(test.metrics.sends, 0)
}

async function staleSendingIsReadBackBeforeClose() {
  const test = fixture({ stack: 'GO', connectionCount: 1663 })
  const old = new Date('2026-08-28T09:00:00Z')
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test',
    linkedinUrl: 'https://www.linkedin.com/in/test-client/', accountId: 'acc_test',
    stackId: 10, stack: 'GO' }, old, 'Europe/Moscow', false)
  run.stage = 'sending'; await test.store.createRun(run)
  const personId = 'stale-sending'
  await test.store.claimHistory({ historyKey: `acc_test:${personId}`, runId: run.runId,
    platformAccountId: 7, accountId: 'acc_test', personId, audience: 'recruiter',
    searchKey: 'old', name: 'Old', headline: 'Recruiter', location: 'Berlin', status: 'sending',
    discoveredAt: old.toISOString(), updatedAt: old.toISOString() })
  test.adapter.listPendingInvitations = async (_accountId: string, offset = 0) =>
    ({ items: offset ? [] : [{ user_id: personId }] })
  const service = createConnectionInviterService({ ...test, now: () => now,
    autoRecover: false, sleep: async () => undefined })
  await service.recover()
  const closed: any = await waitRun(service, run.runId)
  assert.equal(closed.status, 'partial', JSON.stringify(closed))
  assert.equal(closed.stage, 'daily_window_closed')
  const history: any[] = await service.history(7)
  assert.equal(history[0].status, 'sent'); assert.equal(test.metrics.sends, 0)
}

async function unresolvedWriteBlocksNewDay() {
  const test = fixture({ stack: 'GO' })
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test',
    linkedinUrl: 'https://www.linkedin.com/in/test-client/', accountId: 'acc_test',
    stackId: 10, stack: 'GO' }, new Date('2026-08-28T09:00:00Z'), 'Europe/Moscow', false)
  await test.store.createRun(run)
  await test.store.claimHistory({ historyKey: 'acc_test:unsafe', runId: run.runId,
    platformAccountId: 7, accountId: 'acc_test', personId: 'unsafe', audience: 'recruiter',
    searchKey: 'old', name: 'Unsafe', headline: 'Recruiter', location: 'Berlin', status: 'uncertain',
    discoveredAt: run.createdAt, updatedAt: run.updatedAt })
  const service = createConnectionInviterService({ ...test, now: () => now, autoRecover: false })
  await assert.rejects(() => service.start(7),
    (error: any) => error.code === 'connection_invitation_result_pending')
  assert.equal(test.metrics.sends, 0)
}

Promise.all([timerRecovery(), sendingRecovery(), secondWriter(), waitsForHigherPriorityGate(),
  queuedCandidatesSurviveRestart(), staleRunClosesWithoutCarryover(),
  staleSendingIsReadBackBeforeClose(), unresolvedWriteBlocksNewDay()])
  .then(() => console.log('connection recovery tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
