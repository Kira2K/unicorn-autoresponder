import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPostOpenAi } from '../openai-client.ts'
import { createMockDependencies } from '../mock.ts'
import { writePost } from '../writer.ts'
import { mockContext, mockDraft } from '../mock-content.ts'
import { writerFixture } from './writer-fixture.ts'
import type { WriterModel } from '../writer-types.ts'

for (const name of ['mock', 'openai'] as const) {
  test(`${name}: shared model contract and exact request count, no live transport`, async () => {
    let requests = 0
    const canned = writerFixture()
    const mock = createMockDependencies({ acquire: () => () => {} }).generator
    const provider = createPostOpenAi(() => {}, {
      OPENAI_LINKEDIN_POST_API_KEY: 'mock', OPENAI_LINKEDIN_POST_MODEL: 'mock'
    }, async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      assert.equal(body.store, false)
      assert.deepEqual(body.tools, [])
      const payload = JSON.parse(body.input[0].content[0].text)
      const output = payload.task.startsWith('Propose') ? await canned.model.topics(mockContext, []) : mockDraft
      return new Response(JSON.stringify({ status: 'completed', output: [
        { content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }))
    })
    const implementation = name === 'mock' ? mock : provider
    const model: WriterModel = {
      topics: async (...args) => { requests++; return implementation.topics(...args) },
      draft: async (...args) => { requests++; return implementation.draft(...args) }
    }
    const input = { context: structuredClone(mockContext), history: [] }
    const before = structuredClone(input)
    const first = await writePost(input, model)
    assert.equal(first.status, 'ready')
    assert.deepEqual(input, before)
    assert.equal(requests, 2)
    assert.equal((await writePost(input, model, { checkpoint: first.checkpoint })).status, 'ready')
    assert.equal(requests, 2)
  })
}
