import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextSlot, validateSettings, windowEnd } from '../schedule.ts'
import { defaults } from '../types.ts'
import { fixture } from './helpers.ts'
test('Moscow window, saved randomness, weekday and cancelled date', () => {
  const now = Date.parse('2026-09-07T08:00:00+03:00')
  const settings = { ...defaults(203), scheduled: true, days: [1, 3] }
  const slot = nextSlot(settings, now, () => 0.5)!
  assert.equal(new Date(slot.at).toISOString(), '2026-09-07T09:30:00.000Z')
  assert.deepEqual(nextSlot({ ...settings, slot }, now, () => 0.9), slot)
  assert.equal(nextSlot({ ...settings, slot: { ...slot, state: 'started' } }, now, () => 0)?.date, '2026-09-09')
  const cancelled = validateSettings({ ...settings, scheduled: false }, { ...settings, slot })
  assert.equal(cancelled.slot?.state, 'cancelled')
  assert.equal(nextSlot(settings, windowEnd(slot.date), () => 0)?.date, '2026-09-09')
})
test('scheduled flow ignores manual approval and survives restart without duplicates', async () => {
  const f = fixture()
  await f.service.update(203, { ...defaults(203), scheduled: true, days: [1] })
  await f.step()
  assert.equal((await f.run()).mode, 'automatic')
  assert.notEqual((await f.run()).status, 'awaiting_approval')
  f.restart()
  await f.step(6000)
  assert.equal((await f.run()).status, 'published')
  assert.equal(f.counts.publish, 1)
  await f.step(60_000)
  assert.equal(f.counts.publish, 1)
})
test('offline missed window is skipped, awaiting approval prevents scheduled overlap', async () => {
  const f = fixture()
  await f.service.start(203, 'approval_required', 'manual-test')
  await f.step()
  await f.service.update(203, { ...defaults(203), scheduled: true, days: [1] })
  await f.step()
  assert.equal((await f.service.get(203)).runs.length, 1)
  f.setNow(Date.parse('2026-09-07T15:01:00+03:00'))
  await f.step()
  assert.equal((await f.service.get(203)).runs.length, 1)
  assert.equal(f.counts.publish, 0)
  assert.equal((await f.service.get(203)).settings.lastMissedSlot?.date, '2026-09-07')
})
