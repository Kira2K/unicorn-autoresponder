import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { nocoFixture } from './noco-fixture.ts'
import { createPostNocoStore } from '../noco-store.ts'
import { defaults } from '../types.ts'
import { PostError } from '../errors.ts'

test('full publication and six likes work through JSON Noco storage without Unique Fields', async () => {
  const f = fixture(), noco = nocoFixture()
  f.deps.store = createPostNocoStore(noco.http)
  f.restart()
  await f.service.update(203, { ...defaults(203), likes: true })
  await f.service.start(203, 'automatic', 'noco-full-flow')
  for (let i = 0; i < 22; i++) await f.step(90_001)
  const run = await f.run()
  assert.equal(run.status, 'published')
  assert.equal(run.engagement.status, 'completed')
  assert.equal(f.counts.publish, 1)
  assert.equal(f.counts.like, 6)
  assert.equal(noco.saved.get('linkedin_post_runs')?.length, 1)
  assert.equal(noco.saved.get('linkedin_post_history')?.length, 1)
  f.deps.store = createPostNocoStore(noco.http)
  f.restart()
  await f.step(90_001)
  assert.equal(f.counts.publish, 1)
  assert.equal(f.counts.like, 6)
})

test('lost publication reply survives a fresh Noco adapter without a repeated POST', async () => {
  const f = fixture(), noco = nocoFixture()
  f.deps.store = createPostNocoStore(noco.http)
  f.restart()
  const publish = f.deps.adapter.publish
  f.deps.adapter.publish = async (...args) => {
    await publish(...args)
    throw new PostError('lost', 30_000, 503)
  }
  await f.service.start(203, 'automatic', 'noco-lost-post')
  await f.step()
  assert.equal((await f.run()).status, 'uncertain')
  f.deps.store = createPostNocoStore(noco.http)
  f.restart()
  await f.step(30_000)
  assert.equal((await f.run()).status, 'published')
  assert.equal(f.counts.publish, 1)
})
