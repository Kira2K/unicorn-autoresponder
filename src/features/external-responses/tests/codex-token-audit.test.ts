import test from 'node:test'
import assert from 'node:assert/strict'
import { auditCodexTokens } from '../infrastructure/codex-token-audit.ts'

const at = '2026-09-29T16:30:00Z'
const event = (id: string, fields = {}) => ({ timestamp: at, type: 'token_usage_record', payload: {
  response_id: id, usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 20, reasoning_output_tokens: 5, ...fields },
  thread_token_usage: { input_tokens: 9999999 }, turn_token_usage: { input_tokens: 9999999 } } })
async function* events(items: unknown[]) { yield* items }
test('actual response usage is deduplicated across sessions; cumulative snapshots and out-of-scope events are ignored', async () => {
  const r = await auditCodexTokens({ from: at, to: at, sources: [
    { label: 'coordinator', phase: 'development', model: 'gpt-6-astra', events: events([event('a'), event('a'), { ...event('old'), timestamp: '2026-09-28T00:00:00Z' }]) },
    { label: 'assessment', phase: 'runtime', model: 'gpt-5.6-sol', events: events([event('a'), event('b'), { type: 'event_msg', payload: { type: 'token_count', total_tokens: 9999999 } }, event('invalid', { cached_input_tokens: 200 })]) },
  ] })
  assert.deepEqual(r.total, { input: 200, cachedInput: 120, uncachedInput: 80, output: 40, reasoningSubset: 10, responses: 2 })
  assert.equal(r.duplicateEvents, 2); assert.equal(r.invalidEvents, 1)
  assert.equal(r.groups.coordinator.responses, 1); assert.equal(r.groups.assessment.responses, 1)
  assert.equal(JSON.stringify(r).includes('9999999'), false)
})
