const assert = require('node:assert/strict')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
const { fixture, waitRun } = require('./fixtures.ts') as typeof import('./fixtures.ts')

async function run() {
  const test = fixture({ stack: 'Frontend' }); const sleeps: number[] = []; const gate: any[] = []
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-24T09:00:00Z'), random: () => 0,
    sleep: async (milliseconds: number) => { sleeps.push(milliseconds) },
    gate: { acquire(kind: string, _id: string) {
      gate.push([kind]); return () => gate.push(['released'])
    } }
  })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded')
  assert.equal(completed.weeklyLimit, 11)
  assert.equal(completed.dailyQuota, 3)
  assert.deepEqual(completed.audienceQuota, { recruiter: 2, technical: 1 })
  assert.equal(completed.counters.sent, 3)
  assert.equal(test.metrics.sends, 3)
  assert.deepEqual(sleeps, [15_000, 15_000])
  const history: any[] = await service.history(7)
  assert.equal(history.filter(item => item.status === 'sent' && item.audience === 'recruiter').length, 2)
  assert.equal(history.filter(item => item.status === 'sent' && item.audience === 'technical').length, 1)
  assert.equal(history.some(item => 'accountId' in item), false)
  const repeated: any = await service.start(7)
  assert.equal(repeated.runId, completed.runId)
  assert.equal(test.metrics.sends, 3)
  assert.deepEqual(gate, [['connection_inviter'], ['released']])
}
run().then(() => console.log('connection inviter mock e2e passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
