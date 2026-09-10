import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'
import { PostError } from '../errors.ts'
test('manual approval, hash guard, duplicate click and outside-window run', async () => {
  const f = fixture()
  f.setNow(Date.parse('2026-09-07T22:00:00+03:00'))
  const a = await f.service.start(203, 'approval_required', 'test-request')
  assert.equal((await f.service.start(203, 'automatic', 'test-second')).id, a.id)
  await f.step()
  const run = await f.run()
  assert.equal(run.status, 'awaiting_approval')
  assert.equal(f.counts.publish, 0)
  await assert.rejects(f.service.action(run.id, 'approve', 'wrong'))
  await f.service.action(run.id, 'approve', run.hash)
  await f.step()
  await f.step(6000)
  assert.equal((await f.run()).status, 'published')
  assert.equal(f.counts.publish, 1)
  assert.equal(f.held.size, 0)
})
test('stop before POST; lost POST response reconciles after full Retry-After, never reposts', async () => {
  const f = fixture()
  const stopped = await f.service.start(203, 'automatic', 'stop-request')
  await f.service.action(stopped.id, 'stop')
  await f.step()
  assert.equal(f.counts.publish, 0)
  const send = f.deps.adapter.publish
  f.deps.adapter.publish = async (account, text) => { await send(account, text); throw new PostError('timeout', 600_000, 503) }
  const run = await f.service.start(203, 'automatic', 'lost-request')
  await f.step()
  assert.equal((await f.run()).status, 'uncertain')
  f.restart()
  await f.step(599_000)
  assert.equal((await f.run()).status, 'uncertain')
  await f.service.action(run.id, 'stop')
  await f.step(1000)
  assert.equal((await f.run()).status, 'published')
  assert.equal(f.counts.publish, 1)
})
test('six unique likes, separate completion, disabled likes send nothing', async () => {
  const f = fixture()
  await f.service.update(203, { ...defaults(203), likes: true })
  await f.service.start(203, 'automatic', 'likes-request')
  for (let i = 0; i < 22; i++) await f.step(90_001)
  const run = await f.run()
  assert.equal(run.status, 'published')
  assert.equal(run.engagement.status, 'completed')
  assert.equal(f.counts.like, 6)
  assert.equal(new Set(run.engagement.items.map(item => item.account.verifiedProviderId)).size, 6)
  f.restart()
  await f.step(90_001)
  assert.equal(f.counts.like, 6)
})
test('read-only writer refuses external actions', async () => {
  const f = fixture()
  f.deps.writable = false
  f.restart()
  await assert.rejects(f.service.start(203, 'automatic', 'blocked-request'), /read_only/)
  assert.equal(f.counts.publish, 0)
})
