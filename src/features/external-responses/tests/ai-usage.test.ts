import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiClient } from '../infrastructure/ai.ts'
import { createAiUsageRecorder } from '../infrastructure/ai-usage.ts'

const env = { OPENAI_EXTERNAL_RESPONSES_API_KEY: 'secret-test-key', OPENAI_EXTERNAL_RESPONSES_MODEL: 'fixture-model' }
const answer = (usage?: unknown, status = 'completed') => new Response(JSON.stringify({ status, usage,
  output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] }), { status: 200 })

test('counts logical calls, actual retry requests, known tokens and private-input repeats separately', async () => {
  const lines: string[] = [], usage = createAiUsageRecorder(line => lines.push(line))
  let requests = 0
  const client = createAiClient(env, { usage, retrySleep: async () => {}, retryRandom: () => 0.5,
    fetchImpl: (async () => ++requests === 1 ? new Response('{}', { status: 503 }) : answer({ input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 40 } })) as typeof fetch })
  for (let i = 0; i < 2; i++) assert.deepEqual(await client.respond('private CV + private@example.com', 'external_stack_match', {}, 'instructions'), { ok: true })
  const report = usage.report()
  assert.equal(report.logicalCalls, 2)
  assert.equal(report.httpAttempts, 3)
  assert.equal(report.retryAttempts, 1)
  assert.equal(report.knownInputTokens, 200)
  assert.equal(report.knownOutputTokens, 40)
  assert.equal(report.knownCachedInputTokens, 80)
  assert.equal(report.unknownUsageAttempts, 1)
  assert.equal(report.repeatedLogicalInputs, 1)
  assert.equal(report.byOperation[0].operation, 'external_stack_match')
  assert.equal(lines.join('').includes('private@example.com'), false)
  assert.equal(lines.join('').includes('secret-test-key'), false)
})

test('captures billed usage before structured-output parsing fails; measurement cannot trigger retries', async () => {
  let calls = 0
  const usage = createAiUsageRecorder(() => { throw Error('disk full') })
  const client = createAiClient(env, { usage, fetchImpl: (async () => { calls++; return answer({ input_tokens: 8, output_tokens: 3 }, 'incomplete') }) as typeof fetch })
  await assert.rejects(client.respond([], 'external_restriction', {}, ''), /complete/)
  assert.equal(calls, 1)
  assert.equal(usage.report().knownInputTokens, 8)
  assert.equal(usage.report().diagnosticFailures, 2)
})

test('missing/invalid usage is unknown, cached tokens are a subset, and in-flight calls stay visible', async () => {
  const usage = createAiUsageRecorder()
  let finish!: (response: Response) => void
  const client = createAiClient(env, { usage, fetchImpl: (() => new Promise<Response>(resolve => { finish = resolve })) as typeof fetch })
  const pending = client.respond([], 'external_application_answers', {}, '')
  assert.equal(usage.report().pendingAttempts, 1)
  finish(answer({ input_tokens: -1, output_tokens: '500', input_tokens_details: { cached_tokens: 99 } }))
  await pending
  assert.equal(usage.report().unknownUsageAttempts, 1)
  assert.equal(usage.report().knownInputTokens, 0)
  assert.equal(usage.report().knownCachedInputTokens, 0)
})

test('file operations count requests without fabricating inference tokens', async () => {
  const usage = createAiUsageRecorder()
  const client = createAiClient(env, { usage, fetchImpl: (async () => new Response('{"id":"file-test"}')) as typeof fetch })
  await client.upload(Buffer.from('PDF'), 'private-name.pdf', 'application/pdf')
  await client.remove('file-test')
  assert.equal(usage.report().httpAttempts, 2)
  assert.equal(usage.report().unknownUsageAttempts, 0)
  assert.equal(usage.report().inferenceAttempts, 0)
})
