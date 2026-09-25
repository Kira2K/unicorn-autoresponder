import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { PostError } from '../errors.ts'

async function queued() {
  const f = fixture()
  await f.service.start(203, 'automatic', 'skip-safety'); await f.untilPublished()
  await f.service.action((await f.run()).id, 'start-likes'); await f.step()
  return f
}

test('failed skip checkpoint blocks other likes, releases unused gate and recovers after save', async () => {
  const f = await queued(), put = f.deps.store.put.bind(f.deps.store)
  try {
    f.deps.adapter.identity = async account => {
      if (account.platformAccountId === 901) throw new PostError('post_account_not_ready')
    }
    f.deps.store.put = async () => { throw new Error('offline') }
    await f.step(5000); await f.step(90_001)
    assert.equal(f.counts.like, 0); assert.equal(f.held.size, 0)
    assert.equal((await f.service.get(203)).storageError, true)
    f.deps.store.put = put
    for (let i = 0; i < 20; i++) await f.step(90_001)
    assert.equal(f.counts.like, 5); assert.equal((await f.run()).engagement.items[0].status, 'failed')
  } finally { await f.service.close() }
})

test('Stop after skip still cancels all pending likes', async () => {
  const f = await queued()
  try {
    f.deps.adapter.identity = async () => { throw new PostError('post_account_not_ready') }
    await f.step(5000); await f.service.action((await f.run()).id, 'stop')
    for (let i = 0; i < 5; i++) await f.step(90_001)
    assert.equal((await f.run()).engagement.items[0].status, 'failed')
    assert.equal((await f.run()).engagement.status, 'cancelled'); assert.equal(f.counts.like, 0)
  } finally { await f.service.close() }
})

test('identity mismatch is not silently skipped', async () => {
  const f = await queued()
  try {
    f.deps.adapter.identity = async () => { throw new PostError('post_identity_mismatch') }
    await f.step(5000); await f.step(90_001)
    assert.equal((await f.run()).engagement.items[0].status, 'pending')
    assert.equal((await f.run()).errorCode, 'post_identity_mismatch'); assert.equal(f.counts.like, 0)
  } finally { await f.service.close() }
})

test('429 and Retry-After are not converted into skipped accounts', async () => {
  const f = await queued(), identity = f.deps.adapter.identity
  try {
    f.deps.adapter.identity = async () => { throw new PostError('post_account_not_ready', 60_000, 429) }
    await f.step(5000); await f.step(59_999)
    assert.equal((await f.run()).engagement.items[0].status, 'pending'); assert.equal(f.counts.like, 0)
    f.deps.adapter.identity = identity
    await f.step(1); assert.equal(f.counts.like, 1)
  } finally { await f.service.close() }
})

test('not-ready error after reaction POST stays uncertain, never skips or resends', async () => {
  const f = await queued()
  try {
    f.deps.adapter.like = async () => { f.counts.like++; throw new PostError('post_account_not_ready') }
    await f.step(5000)
    assert.equal((await f.run()).engagement.items[0].status, 'uncertain')
    f.restart()
    for (let i = 0; i < 4; i++) await f.step(300_001)
    assert.equal((await f.run()).engagement.status, 'uncertain'); assert.equal(f.counts.like, 1)
    assert.equal((await f.run()).engagement.items[1].status, 'pending')
  } finally { await f.service.close() }
})
