const assert = require('node:assert/strict')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
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
Promise.all([uncertain(), missingStack()]).then(() => console.log('connection safety tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
