import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { fixture } from './helpers.ts'
import { PostError } from '../errors.ts'

async function published() {
  const f = fixture()
  await f.service.start(203, 'automatic', 'manual-safe-post')
  await f.untilPublished()
  return f
}

test('pending save must finish before any manual reaction', async () => {
  const f = await published(), run = await f.run(), put = f.deps.store.put.bind(f.deps.store)
  let release!: () => void
  const saved = new Promise<void>(resolve => { release = resolve })
  f.deps.store.put = async (table, key, value) => {
    if (table === 'runs') await saved
    await put(table, key, value)
  }
  const start = f.service.action(run.id, 'start-likes')
  await setImmediate()
  const ticking = f.step(90_001)
  await setImmediate()
  assert.equal(f.counts.like, 0)
  release(); await start; await ticking
  for (let i = 0; i < 4; i++) await f.step(90_001)
  assert.ok(f.counts.like > 0); assert.equal(f.counts.publish, 1)
})

test('failed queue save blocks likes; restart cannot invent an unsaved queue', async () => {
  const f = await published(), run = await f.run(), put = f.deps.store.put.bind(f.deps.store)
  f.deps.store.put = async () => { throw new Error('storage unavailable') }
  const results = await Promise.allSettled([
    f.service.action(run.id, 'start-likes'), f.service.action(run.id, 'start-likes')])
  for (const result of results) {
    assert.equal(result.status, 'rejected')
    if (result.status === 'rejected') assert.match(result.reason.message, /persistence_unavailable/)
  }
  await f.step(90_001)
  assert.equal(f.counts.like, 0)
  f.deps.store.put = put; f.restart(); await f.step(90_001)
  assert.equal((await f.run()).engagement.status, 'off'); assert.equal(f.counts.like, 0)
})

test('unknown reaction reply is read back after restart, never blindly repeated', async () => {
  const f = await published(), run = await f.run(), like = f.deps.adapter.like
  f.deps.adapter.like = async (account, id) => { await like(account, id); throw new PostError('lost', 30_000, 503) }
  await f.service.action(run.id, 'start-likes')
  for (let i = 0; i < 8 && !f.counts.like; i++) await f.step(6000)
  assert.equal((await f.run()).engagement.status, 'uncertain')
  await f.service.action(run.id, 'start-likes')
  await f.service.action(run.id, 'stop'); f.restart()
  await f.step(30_000); await f.step(90_001)
  assert.equal(f.counts.like, 1); assert.equal(f.counts.publish, 1)
  assert.equal((await f.run()).engagement.items.filter(item => item.status === 'sent').length, 1)
})

test('account gate, Retry-After and existing reaction are respected', async () => {
  const f = await published(), run = await f.run()
  const accounts = await f.deps.source.accounts()
  f.deps.source.accounts = async () => accounts.slice(0, 3)
  await f.deps.adapter.like(accounts[1], run.postId!) // already present externally
  f.counts.like = 0
  await f.service.action(run.id, 'start-likes'); await f.step()
  const release = f.deps.gate.acquire('inviter', 'other', String(accounts[1].platformAccountId))
  await f.step(6000); assert.equal(f.counts.like, 0); release()
  await f.step(15_000); assert.equal(f.counts.like, 0)
  const identity = f.deps.adapter.identity
  f.deps.adapter.identity = async () => { throw new PostError('limited', 60_000, 429) }
  await f.step(6000); await f.step(59_999); assert.equal(f.counts.like, 0)
  f.deps.adapter.identity = identity
  await f.step(1); await f.step(6000); await f.step(90_001)
  assert.equal(f.counts.like, 1); assert.equal((await f.run()).engagement.status, 'partial')
  assert.equal((await f.run()).engagement.items.filter(item => item.status === 'sent').length, 2)
})
