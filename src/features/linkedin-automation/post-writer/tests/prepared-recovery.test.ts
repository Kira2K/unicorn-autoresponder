import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'
import { PostError } from '../errors.ts'

const plan = () => ({ ...defaults(203), scheduled: true, contentMode: 'prepared' as const,
  preparedPosts: [{ date: '2026-09-07', text: 'Prepared post for a careful recovery test, without any rewriting.' }] })

test('lost publish response remains uncertain; restart and Stop never send a second post', async () => {
  const f = fixture(), publish = f.deps.adapter.publish
  f.deps.adapter.publish = async (...args) => { await publish(...args); throw new PostError('timeout', 1000, 503) }
  f.restart(); await f.service.update(203, plan()); await f.step()
  assert.equal((await f.run()).status, 'uncertain')
  await f.service.action((await f.run()).id, 'stop')
  f.restart(); await f.step(600_000)
  assert.equal(f.counts.publish, 1); assert.equal((await f.run()).status, 'uncertain')
})

test('failed meme is not retried after restart and text alone is never published', async () => {
  const f = fixture(); let calls = 0
  f.deps.memes!.render = async () => { calls++; throw new PostError('image_error', 1000, 429) }
  f.restart(); await f.service.update(203, plan()); await f.step()
  assert.equal((await f.run()).status, 'blocked')
  f.restart(); await f.step(600_000)
  assert.equal(calls, 1); assert.equal(f.counts.publish, 0)
})

test('failed plan save creates no schedule or external action', async () => {
  const f = fixture(), put = f.deps.store.put
  f.deps.store.put = async (...args) => { if (args[0] === 'settings') throw Error('SQL unavailable'); return put(...args) }
  f.restart()
  await assert.rejects(f.service.update(203, plan()), /SQL unavailable/)
  await f.step()
  assert.equal(f.counts.publish, 0); assert.equal((await f.service.get(203)).runs.length, 0)
})

test('editing a future day uses the changed text; missed days never catch up with a burst', async () => {
  const f = fixture()
  await f.service.update(203, plan())
  await f.service.update(203, { ...plan(), preparedPosts: [{ date: '2026-09-07', text: 'New exact text for Monday.' }] })
  f.restart(); await f.step(); await f.step(6000)
  assert.equal((await f.run()).draft!.text, 'New exact text for Monday.')
  f.setNow(Date.parse('2026-09-15T10:00:00+03:00')); await f.step()
  assert.equal(f.counts.publish, 1)
})
