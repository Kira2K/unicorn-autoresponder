import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writePost } from '../writer.ts'
import { writerFixture } from './writer-fixture.ts'
import { mockDraft } from '../mock-content.ts'
import type { WriterCheckpoint } from '../writer-types.ts'

test('Stop before and during generation prevents the next model call', async () => {
  const f = writerFixture()
  const controller = new AbortController()
  controller.abort()
  assert.equal((await writePost(f.input, f.model, { signal: controller.signal })).status, 'cancelled')
  assert.deepEqual(f.calls, { topics: 0, draft: 0 })
  const next = new AbortController()
  const topics = f.model.topics
  f.model.topics = async (...args) => { next.abort(); return topics(...args) }
  assert.equal((await writePost(f.input, f.model, { signal: next.signal })).status, 'cancelled')
  assert.equal(f.calls.draft, 0)
})
test('checkpoint failure stops requests; saved topic resumes without selection again', async () => {
  const f = writerFixture()
  let checkpoint: WriterCheckpoint | undefined
  const failure = new Error('storage unavailable')
  await assert.rejects(writePost(f.input, f.model, { onCheckpoint: async value => {
    checkpoint = structuredClone(value)
    throw failure
  } }), error => error === failure)
  assert.equal(f.calls.draft, 0)
  const before = structuredClone(checkpoint)
  assert.equal((await writePost(f.input, f.model, { checkpoint })).status, 'ready')
  assert.deepEqual(checkpoint, before)
  assert.deepEqual(f.calls, { topics: 1, draft: 1 })
})
test('restart counts a repair whose model request actually lost its response', async () => {
  const f = writerFixture()
  let checkpoint: WriterCheckpoint | undefined
  f.model.draft = async () => {
    f.calls.draft++
    if (f.calls.draft === 2) throw new Error('model response lost')
    return { ...mockDraft, text: 'short' }
  }
  await assert.rejects(writePost(f.input, f.model, { onCheckpoint: async value => {
    checkpoint = structuredClone(value)
  } }), /model response lost/)
  assert.equal(checkpoint?.repairCount, 1)
  const result = await writePost(f.input, f.model, { checkpoint })
  assert.equal(result.status, 'blocked')
  assert.equal(result.checkpoint.repairCount, 2)
  assert.equal(f.calls.topics, 1)
  assert.equal(f.calls.draft, 3)
})
test('a verified draft survives restart without another model request', async () => {
  const f = writerFixture()
  const first = await writePost(f.input, f.model)
  const second = await writePost(f.input, f.model, { checkpoint: first.checkpoint })
  assert.equal(second.status, 'ready')
  assert.deepEqual(f.calls, { topics: 1, draft: 1 })
})
test('an in-flight provider failure after cancellation cannot restart generation', async () => {
  const f = writerFixture()
  const controller = new AbortController()
  f.model.draft = async () => { controller.abort(); throw new Error('request lost') }
  assert.equal((await writePost(f.input, f.model, { signal: controller.signal })).status, 'cancelled')
})
