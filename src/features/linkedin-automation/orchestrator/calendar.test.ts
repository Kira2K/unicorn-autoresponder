import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSettings, windows, localDate, occurrenceKey, reservedTime, planTime } from './calendar.ts'
const input = { enabled: true, timezone: 'Europe/Moscow', slots: [
  { id: 'monday', day: 1, start: '10:00', end: '15:00', features: ['invitations'] }] }
test('weekly windows use Moscow midnight; keys survive slot IDs/revisions', () => {
  const config = validateSettings(7, input, 0, 1)
  const now = Date.parse('2026-09-20T21:00:00Z')
  assert.equal(localDate(now), '2026-09-21')
  const [window] = windows(config, now)
  assert.equal(window.start, Date.parse('2026-09-21T07:00:00Z'))
  assert.equal(occurrenceKey(7, 'posts', window.date, window.slot), occurrenceKey(7, 'posts', window.date, { ...window.slot, id: 'changed' }))
})
test('overlapping, empty, duplicate and overnight slots are rejected', () => {
  for (const slots of [[], [input.slots[0], { ...input.slots[0], id: 'second' }],
    [{ ...input.slots[0], start: '22:00', end: '02:00' }], [{ ...input.slots[0], features: ['profile'] }]])
    assert.throws(() => validateSettings(7, { ...input, slots }, 0, 0))
  assert.doesNotThrow(() => validateSettings(7, { ...input, slots: [{ ...input.slots[0], start: '22:00', end: '24:00' }] }, 0, 0))
})
test('duration uses p90 and remaining estimate, then margin; cannot launch too late', () => {
  assert.equal(reservedTime('posts'), 49 * 60_000)
  assert.equal(reservedTime('posts', 60 * 60_000), 88 * 60_000)
  assert.equal(reservedTime('posts', 0, Array(20).fill(60 * 60_000)), 88 * 60_000)
  assert.equal(planTime(0, 100, 30, 71, () => 0), undefined)
  assert.equal(planTime(0, 100, 30, 70, () => .5), 70)
})
