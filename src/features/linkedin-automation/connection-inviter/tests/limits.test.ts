const assert = require('node:assert/strict')
const { dailyAudienceTargets, dailyInvitationLimit, dateParts } =
  require('../limits.ts') as typeof import('../limits.ts')
const { makeRun } = require('../run-model.ts') as typeof import('../run-model.ts')
const { confirmedQuotaExceeded, confirmedQuotaReached, synchronizeConfirmedProgress } =
  require('../daily-progress.ts') as
  typeof import('../daily-progress.ts')

const boundaries = [[0, 5], [149, 5], [150, 7], [199, 7], [200, 8], [250, 10],
  [300, 11], [350, 13], [400, 15], [450, 17], [500, 18], [550, 20], [600, 22],
  [650, 24], [700, 27], [750, 29], [800, 31], [850, 33], [900, 36], [950, 38],
  [999, 38], [1000, 40], [5000, 40]]
for (const [connections, expected] of boundaries) {
  assert.equal(dailyInvitationLimit(connections), expected, String(connections))
}
for (const daily of [...new Set(boundaries.map(([, value]) => value))]) {
  const targets = dailyAudienceTargets(daily)
  assert.equal(targets.recruiter + targets.technical, daily)
  assert.equal(targets.recruiter, Math.round(daily * 0.7))
}
assert.deepEqual(dateParts(new Date('2026-08-24T09:00:00Z'), 'Europe/Moscow'),
  { localDate: '2026-08-24', isoWeekday: 1, weekKey: '2026-08-24' })

const stale = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test',
  linkedinUrl: 'https://linkedin.com/in/test', accountId: 'account', stack: 'GO' },
new Date('2026-08-24T09:00:00Z'), 'Europe/Moscow', false)
stale.audienceQuota = { recruiter: 28, technical: 12 }
stale.counters.sent = 40
stale.counters.sentByAudience = { recruiter: 28, technical: 12 }
const confirmed = synchronizeConfirmedProgress(stale, [], stale.audienceQuota)
assert.equal(confirmed.sentTotal, 0)
assert.deepEqual(confirmed.remaining, { recruiter: 28, technical: 12 })
assert.equal(stale.counters.sent, 0)
assert.deepEqual(stale.counters.shortfallByAudience, { recruiter: 28, technical: 12 })

const historyItem = (runId: string, audience: 'recruiter' | 'technical', status: string,
  index: number) => ({ runId, audience, status, personId: `${runId}-${audience}-${index}` } as any)
const mixedHistory = [historyItem(stale.runId, 'recruiter', 'sent', 1),
  historyItem(stale.runId, 'technical', 'accepted', 2),
  historyItem(stale.runId, 'recruiter', 'sending', 3),
  historyItem(stale.runId, 'technical', 'uncertain', 4),
  historyItem('other-run', 'recruiter', 'sent', 5)]
const mixed = synchronizeConfirmedProgress(stale, mixedHistory, stale.audienceQuota)
assert.deepEqual(mixed.sent, { recruiter: 1, technical: 1 })

const unevenHistory = [
  ...Array.from({ length: 29 }, (_, index) =>
    historyItem(stale.runId, 'recruiter', 'sent', index)),
  ...Array.from({ length: 11 }, (_, index) =>
    historyItem(stale.runId, 'technical', 'accepted', index))
]
const uneven = synchronizeConfirmedProgress(stale, unevenHistory, stale.audienceQuota)
assert.equal(confirmedQuotaReached(uneven, stale.audienceQuota), false)
assert.equal(confirmedQuotaExceeded(uneven, stale.audienceQuota), true)

const exactHistory = [
  ...Array.from({ length: 28 }, (_, index) =>
    historyItem(stale.runId, 'recruiter', 'sent', index)),
  ...Array.from({ length: 12 }, (_, index) =>
    historyItem(stale.runId, 'technical', 'accepted', index))
]
const exact = synchronizeConfirmedProgress(stale, exactHistory, stale.audienceQuota)
assert.equal(confirmedQuotaReached(exact, stale.audienceQuota), true)
assert.equal(confirmedQuotaExceeded(exact, stale.audienceQuota), false)
console.log('connection invitation limit tests passed')
