import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'
import { PostError } from '../errors.ts'
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
test('lost reaction reply and Stop reconcile the same account without another POST', async () => {
  const f = fixture()
  await f.service.update(203, { ...defaults(203), likes: true })
  const like = f.deps.adapter.like
  f.deps.adapter.like = async (account, id) => { await like(account, id); throw new PostError('post_lost', 30_000, 503) }
  const started = await f.service.start(203, 'automatic', 'lost-like-request')
  for (let i = 0; i < 5 && !f.counts.like; i++) await f.step(6000)
  assert.equal(f.counts.like, 1)
  assert.equal((await f.run()).engagement.status, 'uncertain')
  await f.service.action(started.id, 'stop')
  f.restart()
  await f.step(30_000)
  await f.step(6000)
  assert.equal(f.counts.like, 1)
  assert.equal((await f.run()).status, 'published')
  assert.equal((await f.run()).engagement.items.filter(item => item.status === 'sent').length, 1)
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
