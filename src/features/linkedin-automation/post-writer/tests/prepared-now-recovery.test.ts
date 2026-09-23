import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'
import { PostError } from '../errors.ts'
const post = { date: '2026-09-07', text: 'Текст для ручного запуска с проверкой восстановления.' }
const plan = () => ({ ...defaults(203), contentMode: 'prepared' as const, preparedPosts: [post] })

test('read-only, disabled memes and a past date cannot start a new prepared run', async () => {
  const f = fixture()
  await f.service.update(203, plan())
  f.deps.writable = false; f.restart()
  await assert.rejects(f.service.startPrepared(203, post), /post_writer_read_only/)
  f.deps.writable = true; f.deps.memes!.enabled = false; f.restart()
  await assert.rejects(f.service.startPrepared(203, post), /meme_generation_disabled/)
  f.deps.memes!.enabled = true; f.restart(); f.setNow(Date.parse('2026-09-08T10:00:00+03:00'))
  await assert.rejects(f.service.startPrepared(203, post), /post_prepared_past/)
  assert.equal(f.counts.publish, 0); assert.equal((await f.service.get(203)).runs.length, 0)
})

test('unknown SQL create result is read after restart and never creates a second publication', async () => {
  const f = fixture(), put = f.deps.store.put
  await f.service.update(203, plan())
  let failed = false
  f.deps.store.put = async (...args) => {
    await put(...args)
    if (args[0] === 'runs' && !failed) { failed = true; throw Error('lost commit response') }
  }
  f.restart()
  await assert.rejects(f.service.startPrepared(203, post), /post_persistence_unavailable/)
  await f.step(); assert.equal(f.counts.publish, 0)
  f.restart(); await f.service.startPrepared(203, post); await f.step(); await f.step(6000)
  assert.equal(f.counts.publish, 1); assert.equal((await f.service.get(203)).runs.length, 1)
})

test('Stop before execution blocks publication and repeat click does not revive the task', async () => {
  const f = fixture()
  await f.service.update(203, plan())
  const run = await f.service.startPrepared(203, post)
  await f.service.action(run.id, 'stop'); f.restart()
  assert.equal((await f.service.startPrepared(203, post)).status, 'stopped')
  await f.step(); assert.equal(f.counts.publish, 0)
})

test('lost publish response stays uncertain across repeat click and restart, without another POST', async () => {
  const f = fixture(), publish = f.deps.adapter.publish
  f.deps.adapter.publish = async (...args) => { await publish(...args); throw new PostError('timeout', 1000, 503) }
  f.restart(); await f.service.update(203, plan()); await f.service.startPrepared(203, post); await f.step()
  assert.equal((await f.run()).status, 'uncertain')
  f.restart(); await f.service.startPrepared(203, post); await f.step(600_000)
  assert.equal(f.counts.publish, 1); assert.equal((await f.run()).status, 'uncertain')
})
