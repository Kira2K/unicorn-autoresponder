import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writePost } from '../writer.ts'
import { mockContext, mockDraft } from '../mock-content.ts'
import { PostError } from '../errors.ts'
import { writerFixture } from './writer-fixture.ts'
test('standalone Writer succeeds without storage, account or environment', async () => {
  const f = writerFixture()
  const before = structuredClone(f.input)
  const result = await writePost(f.input, f.model)
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.checkpoint.draft, mockDraft)
  assert.deepEqual(result.checkpoint.issues, [])
  assert.deepEqual(f.input, before)
  assert.deepEqual(f.calls, { topics: 1, draft: 1 })
})
test('Writer repairs at most twice and separates provider errors from blocked content', async () => {
  const f = writerFixture()
  f.model.draft = async () => { f.calls.draft++; return { ...mockDraft, text: 'short' } }
  const result = await writePost(f.input, f.model)
  assert.equal(result.status, 'blocked')
  assert.equal(result.checkpoint.repairCount, 2)
  assert.equal(f.calls.draft, 3)
  const failure = new PostError('post_openai_error', 600_000, 429)
  f.model.draft = async () => { throw failure }
  await assert.rejects(writePost(f.input, f.model), error => error === failure)
})
test('repeated calls isolate authors and returned objects', async () => {
  const f = writerFixture()
  const first = await writePost(f.input, f.model)
  first.checkpoint.draft!.text = 'changed by caller'
  f.input.context.role = 'Another author'
  const second = await writePost(f.input, f.model)
  assert.equal(second.checkpoint.draft!.text, mockDraft.text)
  assert.equal(mockContext.role, 'Backend Engineer')
  assert.deepEqual(f.calls, { topics: 2, draft: 2 })
})
test('missing facts and invalid topics block without drafting', async () => {
  const f = writerFixture()
  assert.equal((await writePost({ ...f.input, context: { ...mockContext, facts: [] } }, f.model)).status, 'blocked')
  f.model.topics = async () => ({ topics: [] })
  assert.equal((await writePost(f.input, f.model)).status, 'blocked')
  assert.equal(f.calls.draft, 0)
})
test('invalid output shape is blocked content, not a provider exception', async () => {
  const f = writerFixture()
  f.model.draft = async () => null
  const result = await writePost(f.input, f.model)
  assert.equal(result.status, 'blocked')
  assert.deepEqual(result.checkpoint.issues, ['invalid_shape'])
})
