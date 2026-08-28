const assert = require('node:assert/strict')
const { dailyAudienceTargets, dailyInvitationLimit, dateParts } =
  require('../limits.ts') as typeof import('../limits.ts')

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
console.log('connection invitation limit tests passed')
