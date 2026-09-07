const assert = require('node:assert/strict')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
const { fixture, waitRun } = require('./fixtures.ts') as typeof import('./fixtures.ts')
const { runPhysicalNocoBudgetRegression } = require('./physical-noco-budget.e2e.ts') as
  { runPhysicalNocoBudgetRegression(): Promise<void> }

async function run() {
  const test = fixture({ stack: 'GO', connectionCount: 1663, preflightRejectCount: 4 })
  const sleeps: number[] = []; const gate: any[] = []
  const events: Array<{ stage: string; status: string; details?: any }> = []
  const historyStatuses: string[] = []; const runStages: string[] = []
  let clock = new Date('2026-08-24T09:00:00Z').getTime()
  const updateHistory = test.store.updateHistory.bind(test.store)
  const updateRun = test.store.updateRun.bind(test.store)
  test.store.findHistory = async () => { throw new Error('per-candidate history GET is forbidden') }
  test.store.updateHistory = async (item: any) => {
    historyStatuses.push(item.status); return updateHistory(item)
  }
  test.store.updateRun = async (item: any) => { runStages.push(item.stage); return updateRun(item) }
  const service = createConnectionInviterService({ ...test,
    now: () => new Date(clock), random: () => 0,
    sleep: async (milliseconds: number) => { sleeps.push(milliseconds); clock += milliseconds },
    gate: { acquire(kind: string, _id: string) {
      gate.push([kind]); return () => gate.push(['released'])
    } }, logger: { event(stage: string, status: string, details?: any) {
      events.push({ stage, status, details })
    } }
  })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  const internalCompleted: any = await test.store.getRun(started.runId)
  assert.equal(completed.status, 'succeeded')
  assert.equal(completed.dailyLimit, 40)
  assert.equal(completed.dailyQuota, 40)
  assert.deepEqual(completed.audienceQuota, { recruiter: 28, technical: 12 })
  assert.equal(internalCompleted.usedSearchKeys.some((key: string) => key.startsWith('recruiter-')), true)
  assert.equal(internalCompleted.usedSearchKeys.some((key: string) => key.startsWith('technical-')), true)
  assert.equal(completed.counters.sent, 40)
  assert.equal(completed.stage, 'completed')
  assert.equal(completed.counters.skipped, 4)
  assert.equal(test.metrics.sends, 40)
  const requestStats = test.store.requestStats()
  assert.equal(requestStats.pages + requestStats.creates + requestStats.patches <= 220, true)
  assert.equal(requestStats.patches < 100, true)
  assert.equal(sleeps.reduce((total, value) => total + value, 0) >= 39 * 15_000, true)
  assert.equal(sleeps.every(value => value === 1000), true)
  const history: any[] = await service.history(7)
  assert.equal(history.filter(item => item.status === 'sent' && item.audience === 'recruiter').length, 28)
  assert.equal(history.filter(item => item.status === 'sent' && item.audience === 'technical').length, 12)
  assert.equal(history.filter(item => item.status === 'sent').length, 40)
  assert.equal(history.filter(item => item.status === 'failed').length, 4)
  assert.equal(history.length, 44)
  assert.equal(history.some(item => 'accountId' in item), false)
  const repeated: any = await service.start(7)
  assert.equal(repeated.runId, completed.runId)
  assert.equal(test.metrics.sends, 40)
  assert.deepEqual(gate, [['connection_inviter'], ['released']])
  for (const stage of ['run', 'quota_plan', 'candidate_search', 'invitation_write',
    'invitation_readback']) {
    assert.equal(events.some(event => event.stage === stage && event.status === 'succeeded'), true)
  }
  const immediateWrite = events.some((event, eligibleIndex) => {
    if (event.stage !== 'candidate_search' || event.status !== 'succeeded' ||
      Number(event.details?.eligibleCount) <= 0) return false
    const firstWrite = events.findIndex((candidate, index) => index > eligibleIndex &&
      candidate.stage === 'invitation_write' && candidate.status === 'started')
    const nextSearch = events.findIndex((candidate, index) => index > eligibleIndex &&
      candidate.stage === 'candidate_search' && candidate.status === 'started')
    return firstWrite > eligibleIndex && (nextSearch < 0 || firstWrite < nextSearch)
  })
  assert.equal(immediateWrite, true)
  const nocoSummary = events.find(event => event.stage === 'noco_request_summary')?.details
  assert.equal(Number(nocoSummary?.nocoRequests) <= 220, true)
  assert.equal(historyStatuses.includes('uncertain'), false)
  assert.equal(historyStatuses.includes('sent'), true)
  assert.equal(runStages.includes('readback_pending'), false)
  assert.equal(runStages.at(-1), 'completed')
}
run().then(async () => {
  console.log('connection inviter mock e2e passed')
  await runPhysicalNocoBudgetRegression()
})
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
