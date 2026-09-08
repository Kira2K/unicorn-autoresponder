import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPostSource } from '../source.ts'
import { createFactsExtractor } from '../extract-facts.ts'
import { mockContext } from '../mock-content.ts'
import type { SourceDependencies } from '../source-types.ts'

test('injected source caches facts by reference, revision and bytes without catalog requests', async () => {
  let extractions = 0
  let loads = 0
  let bytes = 'first CV'
  const deps: SourceDependencies = {
    accounts: async () => [{ platformAccountId: 203, clientId: 42, clientName: 'Test',
      unipileAccountId: 'test', verifiedProviderId: 'owner', unipileAccountStatus: 'running' }],
    cvRows: async () => [],
    selectCv: (_rows, clientId) => {
      assert.equal(clientId, 42)
      return { url: 'mock://cv', revision: '1' }
    },
    loadCv: async (url, limit) => {
      loads++
      assert.equal(url, 'mock://cv')
      assert.equal(limit, 20 * 1024 * 1024)
      return { bytes: Buffer.from(bytes), revision: '1' }
    },
    extractFacts: async () => { extractions++; return structuredClone(mockContext) }
  }
  const source = createPostSource(deps)
  assert.equal((await source.accounts()).length, 1)
  const first = await source.context(203)
  assert.deepEqual(await source.context(203, first), first)
  assert.equal(extractions, 1)
  bytes = 'changed in place'
  assert.notEqual((await source.context(203, first)).revision, first.revision)
  assert.equal(extractions, 2)
  assert.equal(loads, 3)
  await assert.rejects(source.context(999), { code: 'post_account_missing' })
  const current = await source.context(203)
  const { factsVersion: _version, ...legacy } = current
  const beforeRefresh = extractions
  const refreshed = await source.context(203, legacy)
  await source.context(203, refreshed)
  assert.equal(extractions, beforeRefresh + 1)
})
test('fact extraction preserves the request and validates the model output', async () => {
  let calls = 0
  const extract = createFactsExtractor(async (input, schema, instructions) => {
    calls++
    assert.match(JSON.stringify(input), /input_file/)
    assert.match(JSON.stringify(schema), /evidence/)
    assert.match(instructions, /never invent/)
    return { ...mockContext, facts: mockContext.facts.map(fact => ({ ...fact, id: 'ignored' })) }
  })
  const result = await extract({ bytes: Buffer.from('mock CV'), revision: '1' })
  assert.equal(result.facts[0].id, 'fact_1')
  assert.equal(calls, 1)
  await assert.rejects(createFactsExtractor(async () => ({ facts: [] }))(
    { bytes: Buffer.from('mock'), revision: '1' }), { code: 'post_facts_missing' })
})
