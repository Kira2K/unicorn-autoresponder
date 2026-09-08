import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { PostError } from '../errors.ts'

test('recovery intent exists before claim; ambiguous claim and restart never publish', async () => {
  const f = fixture(), claim = f.deps.store.claim
  let claims = 0
  f.deps.store.claim = async (key, value) => {
    const run = await f.deps.store.get('runs', value.runId)
    assert.equal(run?.status, 'publishing')
    assert.ok(run?.attemptedAt)
    claims++
    await claim(key, value)
    throw new PostError('post_noco_create_uncertain')
  }
  await f.service.start(203, 'automatic', 'claim-recovery')
  await f.step()
  assert.equal((await f.run()).status, 'uncertain')
  f.restart()
  await f.step(300_001)
  assert.equal(f.counts.publish, 0)
  assert.equal(claims, 1)
})

test('failed intent persistence cannot reserve or send a publication', async () => {
  const f = fixture(), put = f.deps.store.put
  let claims = 0
  f.deps.store.claim = async () => { claims++; throw new Error('must not reach claim') }
  f.deps.store.put = async (bucket, key, value) => {
    if (bucket === 'runs' && 'status' in value && value.status === 'publishing') throw new Error('offline')
    return put(bucket, key, value)
  }
  await f.service.start(203, 'automatic', 'failed-intent')
  await f.step()
  assert.equal(claims, 0)
  assert.equal(f.counts.publish, 0)
})

test('Stop during claim prevents POST and keeps a durable stopped run', async () => {
  const f = fixture(), claim = f.deps.store.claim
  f.deps.store.claim = async (key, value) => {
    const result = await claim(key, value)
    await f.service.action(value.runId, 'stop')
    return result
  }
  await f.service.start(203, 'automatic', 'stop-at-claim')
  await f.step()
  assert.equal((await f.run()).status, 'stopped')
  f.restart()
  await f.step()
  assert.equal(f.counts.publish, 0)
})
