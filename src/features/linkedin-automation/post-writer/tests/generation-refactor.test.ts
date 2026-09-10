import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { fixture } from './helpers.ts'
import { mockDraft } from '../mock-content.ts'

test('generation keeps model counts; one startup history audit is added', async () => {
  const f = fixture()
  const counts = { topics: 0, draft: 0, history: 0, settings: 0, runs: 0 }
  const { topics, draft } = f.deps.generator
  const { list, put } = f.deps.store
  f.deps.generator.topics = async (...args) => { counts.topics++; return topics(...args) }
  f.deps.generator.draft = async (...args) => { counts.draft++; return draft(...args) }
  f.deps.store.list = async (...args) => { if (args[0] === 'history') counts.history++; return list(...args) }
  f.deps.store.put = async (table, key, value) => {
    if (table === 'settings' || table === 'runs') counts[table]++
    return put(table, key, value)
  }
  await f.service.start(203, 'approval_required', 'count-baseline')
  await f.step()
  assert.equal((await f.run()).status, 'awaiting_approval')
  assert.deepEqual(counts, { topics: 1, draft: 1, history: 2, settings: 1, runs: 5 })
  f.restart()
  await f.step()
  assert.equal((await f.run()).status, 'awaiting_approval')
  assert.equal(counts.draft, 1)
  assert.equal(f.counts.publish, 0)
})
test('Stop during an in-flight draft prevents repairs and publication', async () => {
  const f = fixture()
  let release!: (draft: unknown) => void
  let calls = 0
  f.deps.generator.draft = async () => { calls++; return new Promise(resolve => { release = resolve }) }
  const run = await f.service.start(203, 'automatic', 'stop-drafting')
  await f.step()
  assert.equal(calls, 1)
  await f.service.action(run.id, 'stop')
  release({ ...mockDraft, text: 'invalid' })
  await setImmediate()
  await f.step()
  assert.equal((await f.run()).status, 'stopped')
  assert.equal(calls, 1)
  assert.equal(f.counts.publish, 0)
})
test('failed checkpoint blocks the first draft until storage is restored', async () => {
  const f = fixture()
  const put = f.deps.store.put
  let calls = 0
  f.deps.generator.draft = async () => { calls++; return mockDraft }
  f.deps.store.put = async (table, key, value) => {
    if (table === 'runs' && 'topic' in value && value.topic) throw new Error('Noco down')
    return put(table, key, value)
  }
  await f.service.start(203, 'automatic', 'failed-checkpoint')
  await f.step()
  assert.equal(calls, 0)
  assert.equal(f.counts.publish, 0)
  f.deps.store.put = put
  await f.step(31_000)
  assert.equal(calls, 1)
})

test('two healthy repairs add only the existing two reservation writes', async () => {
  const f = fixture()
  const put = f.deps.store.put
  let calls = 0
  let writes = 0
  f.deps.generator.draft = async () => {
    calls++
    return calls < 3 ? { ...mockDraft, text: 'short' } : structuredClone(mockDraft)
  }
  f.deps.store.put = async (table, key, value) => {
    if (table === 'runs') writes++
    return put(table, key, value)
  }
  await f.service.start(203, 'approval_required', 'two-healthy-repairs')
  await f.step()
  assert.equal((await f.run()).status, 'awaiting_approval')
  assert.equal(calls, 3)
  assert.equal(writes, 7)
})
