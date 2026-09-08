import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mockContext, mockDraft } from '../mock-content.ts'
import { parseDraft, parseTopics, validateDraft } from '../content-validation.ts'
import { fixture } from './helpers.ts'
test('valid post and malformed or ungrounded content', () => {
  assert.deepEqual(validateDraft(mockDraft, mockContext, []), [])
  assert.throws(() => parseDraft({ text: 'bad' }))
  assert.ok(validateDraft({ ...mockDraft, text: mockDraft.text.replace('Go services', '500 Go services') },
    mockContext, []).includes('unsupported_number'))
  assert.ok(validateDraft({ ...mockDraft, factIds: ['unknown'] }, mockContext, []).includes('unknown_or_duplicate_fact'))
  assert.throws(() => parseTopics({ topics: [] }, mockContext, []))
})
test('two repairs maximum, no publication of invalid content', async () => {
  const f = fixture()
  let calls = 0
  f.deps.generator.draft = async () => { calls++; return { ...mockDraft, text: 'too short' } }
  await f.service.start(203, 'automatic', 'repair-request')
  await f.step()
  assert.equal(calls, 3)
  assert.equal((await f.run()).status, 'blocked')
  assert.equal(f.counts.publish, 0)
})
