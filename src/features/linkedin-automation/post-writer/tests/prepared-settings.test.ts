import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePreparedPosts } from '../prepared-posts.ts'
import { nextSlot, validateSettings } from '../schedule.ts'
import { defaults } from '../types.ts'
import { fixture } from './helpers.ts'

test('prepared plan preserves pasted Unicode, paragraphs and spaces; validates dates and length', () => {
  const post = { date: '2026-09-07', text: '  Текст 🦄\n\nВторой абзац.  ' }
  assert.deepEqual(validatePreparedPosts([post]), [post])
  for (const input of [[post, post], [{ ...post, date: '2026-02-30' }], [{ ...post, text: '' }],
    [{ ...post, text: 'a'.repeat(3001) }], [post, { ...post, date: '2026-09-14' }], null]) {
    assert.throws(() => validatePreparedPosts(input), /post_prepared_invalid/)
  }
  assert.equal(validatePreparedPosts([{ ...post, text: '🦄'.repeat(3000) }])[0].text.length, 6000)
})

test('prepared schedule skips blank days, supports next week and keeps its saved random time', () => {
  const settings = validateSettings({ ...defaults(203), scheduled: true, contentMode: 'prepared',
    preparedPosts: [{ date: '2026-09-20', text: 'Next Sunday' }] }, defaults(203))
  const now = Date.parse('2026-09-07T09:00:00+03:00')
  const slot = nextSlot(settings, now, () => 0.4)!
  assert.equal(slot.date, '2026-09-20')
  assert.deepEqual(nextSlot({ ...settings, slot }, now, () => 0.8), slot)
  assert.equal(nextSlot({ ...settings, preparedPosts: [] }, now, () => 0), undefined)
  const cleared = validateSettings({ ...settings, preparedPosts: [] }, { ...settings, slot })
  assert.equal(cleared.slot?.state, 'cancelled')
})

test('changing mode cancels only unstarted time; generated weekdays remain unchanged', () => {
  const previous = { ...defaults(203), scheduled: true, days: [1],
    slot: { date: '2026-09-07', at: 100, state: 'planned' as const } }
  const next = validateSettings({ ...previous, contentMode: 'prepared', preparedPosts: [] }, previous)
  assert.equal(next.slot?.state, 'cancelled')
  assert.deepEqual(next.days, [1])
  assert.throws(() => validateSettings({ ...defaults(203), scheduled: true }, defaults(203)), /settings_invalid/)
})

test('missing memes blocks enabling prepared schedule, not saving an inactive plan', async () => {
  const f = fixture(); f.deps.memes!.enabled = false; f.restart()
  const settings = { ...defaults(203), contentMode: 'prepared' as const,
    preparedPosts: [{ date: '2026-09-07', text: 'A prepared post.' }] }
  await f.service.update(203, settings)
  await assert.rejects(f.service.update(203, { ...settings, scheduled: true }), /meme_generation_disabled/)
  await assert.rejects(f.service.start(203, 'automatic', 'manual-prepared'), /post_prepared_manual_unavailable/)
  assert.equal((await f.service.get(203)).runs.length, 0)
})
