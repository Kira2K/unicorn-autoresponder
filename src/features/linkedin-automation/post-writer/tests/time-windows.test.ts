import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextSlot, validateSettings } from '../schedule.ts'
import { validateWindows, dayWindows } from '../time-windows.ts'
import { defaults } from '../types.ts'
import { fixture } from './helpers.ts'
const intervals = [{ start: '10:00', end: '11:00' }, { start: '14:00', end: '16:00' }]
const now = (time: string) => Date.parse(`2026-09-07T${time}:00+03:00`)
test('interval validation rejects overlap, midnight, missing or malformed times', () => {
  for (const input of [[{ start: '23:00', end: '01:00' }], [{ start: '25:00', end: '26:00' }],
    [{ start: '10:00', end: '10:00' }], [...intervals, { start: '10:30', end: '12:00' }]]) {
    assert.throws(() => validateWindows(input))
  }
  assert.throws(() => validateSettings({ ...defaults(1), scheduled: true, days: [1], intervals: [] }, defaults(1)))
})
test('random slot uses only remaining intervals, is stable and recalculated on edit', () => {
  const settings = { ...defaults(1), scheduled: true, days: [1], intervals }
  for (let i = 0; i < 100; i++) {
    const slot = nextSlot(settings, now('10:30'), () => i / 100)!
    assert.ok(dayWindows(slot.date, intervals).some(w => slot.at >= w.start && slot.at < w.end))
    assert.ok(slot.at >= now('10:30'))
    assert.deepEqual(nextSlot({ ...settings, slot }, now('10:35'), () => 0), slot)
  }
  const slot = nextSlot(settings, now('09:00'), () => 0)!
  const edited = validateSettings({ ...settings, intervals: [{ start: '15:00', end: '16:00' }] }, { ...settings, slot })
  assert.equal(nextSlot(edited, now('12:00'), () => 0)?.at, now('15:00'))
})
test('missed first interval waits for next; restart and editing cannot post twice', async () => {
  const f = fixture()
  f.setNow(now('09:00'))
  await f.service.update(203, { ...defaults(203), scheduled: true, days: [1], intervals })
  f.setNow(now('12:00'))
  await f.step()
  assert.equal((await f.service.get(203)).runs.length, 0)
  f.restart()
  f.setNow(now('14:00'))
  await f.step()
  await f.step(6000)
  assert.equal(f.counts.publish, 1)
  await f.service.update(203, { ...defaults(203), scheduled: true, days: [1], intervals: [{ start: '14:30', end: '18:00' }] })
  f.setNow(now('15:00'))
  await f.step()
  assert.equal(f.counts.publish, 1)
  await f.service.close()
})
