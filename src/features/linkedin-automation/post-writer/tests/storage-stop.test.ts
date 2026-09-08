import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { PostError } from '../errors.ts'

test('Noco full Retry-After survives Stop; local Stop works without another HTTP write', async () => {
  const f = fixture()
  const put = f.deps.store.put.bind(f.deps.store)
  let attempts = 0
  f.deps.store.put = async (table, key, value) => {
    attempts++
    if (table === 'runs' && 'status' in value && value.status === 'publishing') {
      throw new PostError('post_noco_error', 3_600_000, 503)
    }
    await put(table, key, value)
  }
  const run = await f.service.start(203, 'automatic', 'noco-long-backoff')
  await f.step()
  const before = attempts
  await f.service.action(run.id, 'stop')
  assert.equal((await f.run()).stop, true)
  assert.equal(attempts, before)
  await f.step(3_599_999)
  assert.equal(attempts, before)
  assert.equal(f.counts.publish, 0)
  f.deps.store.put = put
  await f.step(1)
  assert.equal(f.counts.publish, 0)
  assert.equal((await f.run()).status, 'uncertain')
})

test('ordinary waiting ticks and SSE snapshots do not persist or read Noco again', async () => {
  const f = fixture()
  const run = await f.service.start(203, 'approval_required', 'waiting-no-poll')
  await f.step()
  let calls = 0
  const put = f.deps.store.put.bind(f.deps.store)
  const list = f.deps.store.list.bind(f.deps.store)
  f.deps.store.put = async (...args) => { calls++; await put(...args) }
  f.deps.store.list = async (...args) => { calls++; return list(...args) }
  for (let i = 0; i < 60; i++) { await f.step(1000); await f.service.get(203) }
  assert.equal(calls, 0)
  assert.equal((await f.run()).id, run.id)
})
