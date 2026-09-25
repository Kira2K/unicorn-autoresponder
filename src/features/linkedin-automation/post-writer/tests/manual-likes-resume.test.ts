import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pausedLikesFixture } from './helpers.ts'
import { PostError } from '../errors.ts'
import type { PostRun } from '../types.ts'

test('explicit continuation preserves plan and confirmed likes; restart alone does not resume', async () => {
  const f = await pausedLikesFixture()
  try {
    const before = await f.run(), settings = (await f.service.get(203)).settings
    await f.step(90_001); assert.equal(f.counts.like, 1)
    f.deps.adapter.identity = async a => {
      if (a.platformAccountId === 902) throw new PostError('post_account_not_ready')
    }
    const results = await Promise.all([f.service.action(before.id, 'start-likes'), f.service.action(before.id, 'start-likes')])
    assert.ok(results.every(r => r.engagement.status === 'running'))
    assert.deepEqual(results[0].engagement.items, before.engagement.items)
    for (let i = 0; i < 20; i++) await f.step(90_001)
    const after = await f.run()
    assert.equal(f.counts.publish, 1); assert.equal(f.counts.like, 5)
    assert.deepEqual(after.engagement.items[0], before.engagement.items[0])
    assert.equal(after.engagement.items[1].status, 'failed')
    assert.equal(after.errorCode, undefined); assert.equal(after.engagement.status, 'partial')
    assert.deepEqual((await f.service.get(203)).settings, settings)
  } finally { await f.service.close() }
})

test('continuation never revives stopped, uncertain, attempted or unrelated failures', async () => {
  const patches: Array<(r: PostRun) => void> = [r => { r.stop = true }, r => { r.errorCode = 'post_identity_mismatch' },
    r => { r.engagement.items[1].status = 'uncertain' }, r => { r.engagement.items[1].attemptedAt = 1 },
    r => { r.engagement.requestedManually = false }, r => { r.engagement.status = 'cancelled' },
    r => { r.likesEnabled = false }, r => { r.trigger = 'scheduled' }]
  for (const patch of patches) {
    const f = await pausedLikesFixture()
    try {
      const run = await f.run(); patch(run)
      await f.deps.store.put('runs', run.id, run); f.restart()
      try { await f.service.action(run.id, 'start-likes') } catch (e) { assert.match(String(e), /post_likes_start_invalid/) }
      assert.deepEqual((await f.run()).engagement, run.engagement); assert.equal(f.counts.like, 1)
    } finally { await f.service.close() }
  }
})

test('busy account and failed persistence do not resume the remaining reactions', async () => {
  const f = await pausedLikesFixture()
  try {
    const run = await f.run(), other = await f.service.start(203, 'approval_required', 'another-post')
    await assert.rejects(f.service.action(run.id, 'start-likes'), /post_account_busy/)
    await f.service.action(other.id, 'stop')
    f.deps.store.put = async () => { throw new Error('offline') }
    await assert.rejects(f.service.action(run.id, 'start-likes'), /post_persistence_unavailable/)
    await f.step(90_001); assert.equal(f.counts.like, 1)
  } finally { await f.service.close() }
})
