import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { defaults, type PostRun } from '../types.ts'

async function published() {
  const f = fixture()
  await f.service.start(203, 'automatic', 'manual-likes-post')
  await f.untilPublished()
  assert.equal((await f.run()).status, 'published')
  return f
}

test('manual likes run once, preserve settings/post, and survive restart', async () => {
  const f = await published(), before = await f.run()
  const settings = (await f.service.get(203)).settings
  await Promise.all([f.service.action(before.id, 'start-likes'), f.service.action(before.id, 'start-likes')])
  for (let i = 0; i < 5; i++) await f.step(90_001)
  f.restart()
  for (let i = 0; i < 20; i++) await f.step(90_001)
  const after = await f.run()
  assert.equal(after.engagement.status, 'completed')
  assert.equal(after.engagement.requestedManually, true)
  assert.equal(f.counts.like, 6); assert.equal(f.counts.publish, 1)
  assert.equal(after.postId, before.postId); assert.deepEqual(after.draft, before.draft)
  assert.deepEqual((await f.service.get(203)).settings, settings)
  await f.service.action(before.id, 'start-likes')
  await f.step(90_001)
  assert.equal(f.counts.like, 6)
})

test('rejects unpublished, scheduled, stopped and previously attempted queues', async () => {
  const variants: Partial<PostRun>[] = [
    { status: 'uncertain' }, { status: 'ready' }, { trigger: 'scheduled' }, { stop: true },
    { postId: undefined }, { target: undefined }, { likesEnabled: true },
    ...(['partial', 'cancelled', 'completed', 'uncertain', 'running'] as const)
      .map(status => ({ engagement: { status, target: 6, items: [] } }))
  ]
  for (const patch of variants) {
    const f = await published(), run = { ...await f.run(), ...patch }
    await f.deps.store.put('runs', run.id, run); f.restart()
    await assert.rejects(f.service.action(run.id, 'start-likes'), /post_likes_start_invalid/)
    assert.equal(f.counts.like, 0); assert.equal(f.counts.publish, 1)
    assert.equal((await f.service.get(203)).runs[0].canStartLikes, false)
  }
})

test('manual queue ignores future-post checkbox, but Stop cancels it permanently', async () => {
  const f = await published(), run = await f.run()
  await f.service.action(run.id, 'start-likes')
  await f.service.update(203, defaults(203))
  for (let i = 0; i < 8 && f.counts.like < 1; i++) await f.step(6000)
  assert.equal(f.counts.like, 1)
  await f.service.action(run.id, 'stop')
  for (let i = 0; i < 10; i++) await f.step(90_001)
  assert.equal(f.counts.like, 1); assert.equal((await f.run()).engagement.status, 'cancelled')
  await assert.rejects(f.service.action(run.id, 'start-likes'), /post_likes_start_invalid/)
})

test('another active run and read-only backend cannot start manual likes', async () => {
  const f = await published(), run = await f.run()
  const other = await f.service.start(203, 'approval_required', 'other-active-post')
  await assert.rejects(f.service.action(run.id, 'start-likes'), /post_account_busy/)
  await f.service.action(other.id, 'stop')
  f.deps.writable = false; f.restart()
  await assert.rejects(f.service.action(run.id, 'start-likes'), /read_only/)
  assert.equal(f.counts.like, 0)
})
