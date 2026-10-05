import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyInvitations, withdrawalDelay } from './policy.ts'
test('strictly older than 14 days; unknown, invalid and future dates cannot be withdrawn', () => {
  const now = Date.parse('2026-09-17T12:00:00.000Z')
  const dates = ['2026-09-03T11:59:59.999Z', '2026-09-03T12:00:00Z', undefined,
    '3 weeks ago', '2026-02-30T12:00:00Z', '2026-09-18T00:00:00Z', '2026-08-01']
  const result = classifyInvitations(dates.map((createdAt, i) => ({ id: `${i}`, name: 'Test', createdAt })), now, [])
  assert.deepEqual(result.map(r => r.eligible), [true, false, false, false, false, false, false])
  assert.equal(result[0].ageDays, 14)
  assert.equal(classifyInvitations([{ id: '0', name: 'Test', createdAt: dates[0] }], now, ['0'])[0].eligible, false)
})
test('random delay ranges from five to fifteen seconds', () => {
  assert.equal(withdrawalDelay(() => 0), 5000)
  assert.equal(withdrawalDelay(() => 1), 15000)
  assert.equal(withdrawalDelay(() => 0.5), 10000)
  assert.equal(withdrawalDelay(() => 0.25), 7500)
  assert.equal(withdrawalDelay(() => 0.75), 12500)
  assert.equal(withdrawalDelay(() => -1), 5000)
  assert.equal(withdrawalDelay(() => NaN), 15000)
})
