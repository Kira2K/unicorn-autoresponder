import assert from 'node:assert/strict'
import { createProfileLogger } from '../profile-logger.ts'
import { createOpenAiHttp } from '../generation/openai-http.ts'
import { GENERATED_PROFILE_SCHEMA } from '../generation/profile-schema.ts'

async function run() {
  assert.equal(JSON.stringify(GENERATED_PROFILE_SCHEMA).includes('uniqueItems'), false)
  const lines: string[] = []
  const logger = createProfileLogger({ jobId: 'generation-log-test',
    writeLine: line => lines.push(line) })
  const client = createOpenAiHttp({ apiKey: 'must-not-leak', model: 'test-model',
    timeoutMs: 1000, maxOutputTokens: 100, logger,
    fetchImpl: (async () => new Response(JSON.stringify({ error: {
      type: 'invalid_request_error', code: 'invalid_json_schema',
      param: 'text.format.schema',
      message: "'uniqueItems' is not permitted. private-cv-text"
    } }), { status: 400, headers: { 'x-request-id': 'req-safe-123' } })) as typeof fetch })

  await assert.rejects(client.respond('private input', 'linkedin_profile', {}, 'private rules'),
    (error: any) => error.code === 'openai_schema_invalid' &&
      error.details?.diagnostic === 'invalid.json.schema.unique_items')
  const success = createOpenAiHttp({ apiKey: 'must-not-leak', model: 'test-model',
    timeoutMs: 1000, maxOutputTokens: 100, logger,
    fetchImpl: (async () => new Response(JSON.stringify({ usage: { input_tokens: 30,
      output_tokens: 10, input_tokens_details: { cached_tokens: 20 } },
    output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] }),
    { status: 200 })) as typeof fetch })
  await success.respond('private input', 'safe_usage', {}, 'private rules')
  const records = lines.map(line => JSON.parse(line))
  const failed = records.find(record => record.stage === 'openai_response' &&
    record.status === 'failed')
  assert.equal(failed.httpStatus, 400)
  assert.equal(failed.requestId, 'req-safe-123')
  assert.equal(failed.operation, 'linkedin_profile')
  assert.equal(failed.diagnostic, 'invalid_json_schema_unique_items')
  assert.equal(failed.fieldPath, 'text.format.schema')
  const usage = records.find(record => record.stage === 'openai_usage')
  assert.deepEqual({ input: usage.inputTokens, output: usage.outputTokens,
    cached: usage.cachedTokens }, { input: 30, output: 10, cached: 20 })
  assert.match(JSON.stringify(records), /durationMs/)
  assert.doesNotMatch(JSON.stringify(records), /must-not-leak|private input|private-cv-text/)
}

run().then(() => console.log('profile generation logging tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})
