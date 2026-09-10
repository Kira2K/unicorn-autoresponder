import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writerFixture } from './writer-fixture.ts'
import { writePost } from '../writer.ts'
test('off-topic draft can be repaired, using the same total repair budget', async () => {
  const f = writerFixture()
  let textReviews = 0
  f.model.review = async (_context, input) => ({ allowed: true, uncertain: false,
    onTopic: input.text ? ++textReviews > 1 : true })
  const result = await writePost({ ...f.input, rules: { requestedTopic: 'Go errors' } }, f.model)
  assert.equal(result.status, 'ready')
  assert.equal(result.checkpoint.repairCount, 1)
  assert.equal(f.calls.draft, 2)
  f.model.review = async (_context, input) => ({ allowed: true, uncertain: false, onTopic: !input.text })
  const blocked = await writePost({ ...f.input, rules: { requestedTopic: 'Go errors' } }, f.model)
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.checkpoint.repairCount, 2)
})
