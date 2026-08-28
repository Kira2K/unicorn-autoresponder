const assert = require('node:assert/strict')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
const { failedRunCanRetry } = require('../retry-policy.ts') as typeof import('../retry-policy.ts')
const { makeRun } = require('../run-model.ts') as typeof import('../run-model.ts')
const { fixture, waitRun } = require('./fixtures.ts') as typeof import('./fixtures.ts')

const clock = () => new Date('2026-08-24T09:00:00Z')
async function uncertain() {
  const test = fixture({ stack: 'Frontend', sendFailure: Object.assign(new Error('timeout'),
    { code: 'unipile_timeout' }) })
  const service = createConnectionInviterService({ ...test, now: clock, sleep: async () => undefined })
  const started: any = await service.start(7); const stopped: any = await waitRun(service, started.runId)
  assert.equal(stopped.status, 'uncertain')
  assert.equal(test.metrics.sends, 1)
  assert.equal((await service.history(7)).some((item: any) => item.status === 'uncertain'), true)
  await service.start(7); assert.equal(test.metrics.sends, 1)
}
async function missingStack() {
  const test = fixture({}); const service = createConnectionInviterService({ ...test, now: clock,
    sleep: async () => undefined })
  const paused: any = await service.start(7)
  assert.equal(paused.status, 'paused'); assert.equal(paused.stage, 'stack_required')
  assert.equal(test.metrics.reads, 0); assert.equal(test.metrics.sends, 0)
  const resumed: any = await service.start(7, { safeRecruiterOnly: true })
  const completed: any = await waitRun(service, resumed.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.audienceQuota.technical, 0)
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
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.searched, 5)
  assert.equal(test.metrics.sends, 11)
}
async function safeHistoryRetry() {
  const timeout = Object.assign(new Error('timeout'), { code: 'unipile_timeout' })
  const test = fixture({ stack: 'Frontend', pendingReadFailure: timeout, stablePeople: true })
  const service = createConnectionInviterService({ ...test, now: clock, sleep: async () => undefined })
  const initial: any = await service.start(7); const failed: any = await waitRun(service, initial.runId)
  const history = await service.history(7)
  assert.equal(failed.status, 'failed'); assert.equal(failed.counters.sent, 0)
  assert.equal(history.some((item: any) => item.status === 'eligible'), true)
  const retried: any = await service.start(7); const completed: any = await waitRun(service, retried.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(test.metrics.sends, 11)
}
async function stoppableRun() {
  const test = fixture({ stack: 'Frontend' }); const waits: Array<() => void> = []; const events: any[] = []
  const service = createConnectionInviterService({ ...test, now: clock, random: () => 0,
    sleep: async () => new Promise<void>(resolve => waits.push(resolve)),
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
async function orphanedRunStop() {
  const test = fixture({ stack: 'Frontend' })
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test Client',
    linkedinUrl: 'https://www.linkedin.com/in/test/', accountId: 'acc_test', stack: 'Frontend' },
  clock(), 'Europe/Moscow', false)
  await test.store.createRun(run)
  const service = createConnectionInviterService({ ...test, now: clock })
  const stopped: any = await service.stopRun(run.runId)
  assert.equal(stopped.status, 'stopped'); assert.equal(stopped.stage, 'stopped_by_admin')
}
const failedRun = { runId: 'run-1', status: 'failed', counters: { sent: 0 } } as any
assert.equal(failedRunCanRetry(failedRun, [{ runId: 'run-1', status: 'eligible' } as any]), true)
assert.equal(failedRunCanRetry(failedRun, [{ runId: 'run-1', status: 'skipped' } as any]), true)
assert.equal(failedRunCanRetry(failedRun, [{ runId: 'run-1', status: 'sending' } as any]), false)
assert.equal(failedRunCanRetry(failedRun,
  [{ runId: 'run-1', status: 'failed', sentAt: clock().toISOString() } as any]), false)
Promise.all([uncertain(), missingStack(), weekendRun(), safeFailedRetry(), safeHistoryRetry(),
  stoppableRun(), orphanedRunStop()])
  .then(() => console.log('connection safety tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
