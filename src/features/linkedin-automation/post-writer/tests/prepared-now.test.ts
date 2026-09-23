import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'

const post = { date: '2026-09-09', text: '  Готовый текст на среду 🦄\n\nБез переписывания.  ' }
const plan = () => ({ ...defaults(203), contentMode: 'prepared' as const, preparedPosts: [post] })

test('publish now uses saved text and meme outside schedule hours, without enabling the schedule', async () => {
  const f = fixture()
  f.deps.source.context = async () => { throw Error('must not read CV') }
  f.restart(); f.setNow(Date.parse('2026-09-07T23:00:00+03:00'))
  await f.service.update(203, plan())
  const run = await f.service.startPrepared(203, post)
  assert.equal(run.id, 'scheduled-203-2026-09-09'); assert.equal(run.trigger, 'manual')
  assert.equal(run.mode, 'automatic'); assert.equal(f.counts.publish, 0)
  await f.step(); await f.step(6000)
  assert.equal((await f.run()).status, 'published'); assert.equal((await f.run()).draft!.text, post.text)
  assert.ok((await f.run()).postImageId)
  assert.equal((await f.service.get(203)).settings.scheduled, false)
})

test('double click, restart and later schedule all reuse the same daily run', async () => {
  const f = fixture()
  await f.service.update(203, plan())
  const results = await Promise.all(Array.from({ length: 10 }, () => f.service.startPrepared(203, post)))
  assert.equal(new Set(results.map(run => run.id)).size, 1)
  await f.step(); await f.step(6000); f.restart()
  assert.equal((await f.service.startPrepared(203, post)).status, 'published')
  await f.service.update(203, { ...plan(), scheduled: true })
  f.setNow(Date.parse('2026-09-09T10:00:00+03:00')); await f.step(); await f.step(6000)
  assert.equal(f.counts.publish, 1); assert.equal((await f.service.get(203)).runs.length, 1)
  await assert.rejects(f.service.update(203, { ...plan(), preparedPosts: [{ ...post, text: 'Different' }] }),
    /post_prepared_day_started/)
})

test('manual start racing with schedule cannot create a second run', async () => {
  const f = fixture(), today = { ...post, date: '2026-09-07' }
  await f.service.update(203, { ...plan(), scheduled: true, preparedPosts: [today] })
  await Promise.all([f.service.startPrepared(203, today), f.service.tick()])
  await f.step(); await f.step(6000)
  assert.equal(f.counts.publish, 1); assert.equal((await f.service.get(203)).runs.length, 1)
})

test('only the saved plan of this account can be published; stale text never replaces it', async () => {
  const f = fixture()
  await f.service.update(203, plan())
  for (const input of [undefined, { ...post, date: 'invalid' }, { ...post, text: '' }]) {
    await assert.rejects(f.service.startPrepared(203, input), /post_prepared_invalid/)
  }
  await assert.rejects(f.service.startPrepared(203, { ...post, text: 'unsaved edit' }), /post_prepared_changed/)
  await assert.rejects(f.service.startPrepared(901, post), /post_prepared_changed/)
  assert.equal(f.counts.publish, 0); assert.equal((await f.service.get(203)).runs.length, 0)
})

test('another active task blocks manual publication instead of publishing another student or day', async () => {
  const f = fixture()
  await f.service.start(203, 'approval_required', 'existing-manual-run')
  await f.service.update(203, plan())
  await assert.rejects(f.service.startPrepared(203, post), /post_account_busy/)
  assert.equal((await f.service.get(203)).runs.length, 1)
})

test('an early published day is consumed without recording it as missed after its window', async () => {
  const f = fixture()
  await f.service.update(203, { ...plan(), scheduled: true })
  await f.service.startPrepared(203, post); await f.step(); await f.step(6000)
  f.setNow(Date.parse('2026-09-09T23:00:00+03:00')); f.restart(); await f.step()
  const snapshot = await f.service.get(203)
  assert.equal(snapshot.settings.lastMissedSlot, undefined)
  assert.equal(snapshot.settings.slot!.state, 'started'); assert.equal(f.counts.publish, 1)
})

test('multiple future manual days do not make the schedule alternate between already consumed dates', async () => {
  const f = fixture(), posts = [post, { ...post, date: '2026-09-10', text: 'Another day' }]
  await f.service.update(203, { ...plan(), preparedPosts: posts })
  for (const item of posts) {
    const run = await f.service.startPrepared(203, item)
    await f.service.action(run.id, 'stop')
  }
  await f.service.update(203, { ...plan(), scheduled: true, preparedPosts: posts })
  await f.step(); await f.step()
  const stable = structuredClone((await f.service.get(203)).settings)
  await f.step()
  assert.deepEqual((await f.service.get(203)).settings, stable)
  assert.notEqual(stable.slot?.state, 'planned'); assert.equal(f.counts.publish, 0)
})
