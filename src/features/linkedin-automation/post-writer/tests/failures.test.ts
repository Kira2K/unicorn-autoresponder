import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'
import { PostError } from '../errors.ts'

for (const afterPost of [false, true]) test(`500 budget expires across restart, afterPost=${afterPost}`, async () => {
  const f = fixture(); let reads = 0
  const failure = () => Object.assign(new Error('server'), { code: 'unipile_http_500',
    details: { httpStatus: 500, retryAfterMs: 300_000 } })
  if (afterPost) f.deps.adapter.read = async () => { reads++; throw failure() }
  else f.deps.adapter.identity = async () => { reads++; throw failure() }
  try {
    await f.service.start(203, 'automatic', `budget-${afterPost}`)
    await f.step(); await f.step(6000)
    const first = (await f.run()).recovery!.firstFailedAt
    f.restart(); f.setNow(first + 20 * 60_000 - 1); await f.step()
    assert.equal((await f.run()).recovery!.skippedAt, undefined)
    const count = reads
    f.setNow(first + 20 * 60_000); await f.step()
    const run = await f.run()
    assert.equal(reads, count, 'expiry must not make another provider request')
    assert.equal(run.recovery!.firstFailedAt, first)
    assert.ok(run.recovery!.skippedAt)
    assert.equal(run.status, afterPost ? 'uncertain' : 'blocked')
    assert.equal(f.counts.publish, afterPost ? 1 : 0)
    f.restart(); await f.step(3600_000)
    assert.equal(reads, count); assert.equal(f.counts.publish, afterPost ? 1 : 0)
  } finally { await f.service.close() }
})
test('Noco intent failure prevents POST; restart reconciles saved intent without sending', async () => {
  const f = fixture()
  const put = f.deps.store.put.bind(f.deps.store)
  f.deps.store.put = async (table, key, value) => {
    if (table === 'runs' && 'status' in value && value.status === 'publishing') throw new Error('Noco unavailable')
    await put(table, key, value)
  }
  await f.service.start(203, 'automatic', 'noco-error')
  await f.step()
  assert.equal(f.counts.publish, 0)
  assert.equal((await f.service.get(203)).storageError, true)
  f.deps.store.put = put
  await f.step(30_000)
  assert.equal(f.counts.publish, 0)
  assert.equal((await f.run()).status, 'uncertain')
})
test('post accepted but state persistence fails: recovery only reads', async () => {
  const f = fixture()
  const put = f.deps.store.put.bind(f.deps.store)
  f.deps.store.put = async (table, key, value) => {
    if (table === 'runs' && 'status' in value && value.status === 'verifying') throw new Error('Noco failed')
    await put(table, key, value)
  }
  await f.service.start(203, 'automatic', 'accepted-request')
  await f.step()
  assert.equal(f.counts.publish, 1)
  f.deps.store.put = put
  f.restart()
  await f.step(30_000)
  assert.equal((await f.run()).status, 'published')
  assert.equal(f.counts.publish, 1)
})
test('lost reaction reply stays unknown after Stop without another POST or read-back', async () => {
  const f = fixture()
  await f.service.update(203, { ...defaults(203), likes: true })
  const like = f.deps.adapter.like
  f.deps.adapter.like = async (account, id) => { await like(account, id); throw new PostError('post_lost', 30_000, 503) }
  const started = await f.service.start(203, 'automatic', 'lost-like-request')
  for (let i = 0; i < 5 && !f.counts.like; i++) await f.step(6000)
  assert.equal(f.counts.like, 1)
  assert.equal((await f.run()).engagement.status, 'uncertain')
  await f.service.action(started.id, 'stop')
  f.deps.adapter.reacted = async () => { throw Error('must not read after Stop') }
  f.restart()
  await f.step(30_000)
  await f.step(6000)
  assert.equal(f.counts.like, 1)
  assert.equal((await f.run()).status, 'published')
  assert.equal((await f.run()).engagement.items.filter(item => item.status === 'uncertain').length, 1)
  assert.equal((await f.run()).engagement.status, 'cancelled')
})
test('likes disabled mid-run cancel only pending actions; shortage stays separate', async () => {
  const f = fixture()
  const accounts = f.deps.source.accounts
  f.deps.source.accounts = async () => (await accounts()).slice(0, 3)
  await f.service.update(203, { ...defaults(203), likes: true })
  await f.service.start(203, 'automatic', 'shortage-request')
  for (let i = 0; i < 10; i++) await f.step(90_001)
  assert.equal((await f.run()).status, 'published')
  assert.equal((await f.run()).engagement.status, 'partial')
  assert.equal(f.counts.like, 2)
  await f.service.update(203, { ...defaults(203), likes: false })
  await f.step(90_001)
  await f.service.update(203, { ...defaults(203), likes: true })
  await f.step(90_001)
  assert.equal(f.counts.like, 2)
})
