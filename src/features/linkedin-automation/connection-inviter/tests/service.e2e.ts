const assert = require('node:assert/strict')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
const { fixture, waitRun } = require('./fixtures.ts') as typeof import('./fixtures.ts')

async function run() {
  const test = fixture({ stack: 'GO', connectionCount: 1663, preflightRejectCount: 4 })
  const sleeps: number[] = []; const gate: any[] = []
  const events: Array<{ stage: string; status: string }> = []
  const historyStatuses: string[] = []; const runStages: string[] = []
  const updateHistory = test.store.updateHistory.bind(test.store)
  const updateRun = test.store.updateRun.bind(test.store)
  test.store.updateHistory = async (item: any) => {
    historyStatuses.push(item.status); return updateHistory(item)
  }
  test.store.updateRun = async (item: any) => { runStages.push(item.stage); return updateRun(item) }
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-24T09:00:00Z'), random: () => 0,
    sleep: async (milliseconds: number) => { sleeps.push(milliseconds) },
    gate: { acquire(kind: string, _id: string) {
      gate.push([kind]); return () => gate.push(['released'])
    } }, logger: { event(stage: string, status: string) { events.push({ stage, status }) } }
  })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded')
  assert.equal(completed.dailyLimit, 40)
  assert.equal(completed.dailyQuota, 40)
  assert.deepEqual(completed.audienceQuota, { recruiter: 28, technical: 12 })
  assert.equal(completed.usedSearchKeys.some((key: string) => key.startsWith('recruiter-')), true)
  assert.equal(completed.usedSearchKeys.some((key: string) => key.startsWith('technical-')), true)
  assert.equal(completed.counters.sent, 40)
  assert.equal(completed.stage, 'completed')
  assert.equal(completed.counters.skipped, 4)
  assert.equal(test.metrics.sends, 40)
  assert.equal(sleeps.reduce((total, value) => total + value, 0), 760_000)
  assert.equal(sleeps.every(value => value === 1000), true)
  const history: any[] = await service.history(7)
  assert.equal(history.filter(item => item.status === 'sent' && item.audience === 'recruiter').length, 28)
  assert.equal(history.filter(item => item.status === 'sent' && item.audience === 'technical').length, 12)
  assert.equal(history.some(item => 'accountId' in item), false)
  const repeated: any = await service.start(7)
  assert.equal(repeated.runId, completed.runId)
  assert.equal(test.metrics.sends, 40)
  assert.deepEqual(gate, [['connection_inviter'], ['released']])
  for (const stage of ['run', 'quota_plan', 'candidate_search', 'invitation_write',
    'invitation_readback']) {
    assert.equal(events.some(event => event.stage === stage && event.status === 'succeeded'), true)
  }
  assert.equal(historyStatuses.includes('uncertain'), true)
  assert.equal(historyStatuses.includes('sent'), true)
  assert.equal(runStages.includes('readback_pending'), true)
}
run().then(() => console.log('connection inviter mock e2e passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
