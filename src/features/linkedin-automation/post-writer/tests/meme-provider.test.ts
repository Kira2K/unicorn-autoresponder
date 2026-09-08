import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMemeImageRenderer } from '../meme-openai-image.ts'
import { mockMemePng } from '../meme-mock.ts'
import { createMemeAssets } from '../meme-assets.ts'
import { memoryJsonFiles } from '../memory-json-files.ts'
import { digest } from '../content-identity.ts'
const config = { enabled: true, apiKey: 'fixture-not-a-key', model: 'gpt-image-2' }
test('explicit Image API body, unchanged prompt, one image and no fallback', async () => {
  const png = mockMemePng(); let calls = 0
  const renderer = createMemeImageRenderer(config, () => {}, async (url, init) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/images/generations')
    assert.deepEqual(JSON.parse(String(init?.body)), { model: 'gpt-image-2', prompt: 'exact prompt',
      n: 1, size: '1024x1280', output_format: 'png', quality: 'medium' })
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
  })
  assert.deepEqual(await renderer('exact prompt'), png); assert.equal(calls, 1)
})
test('429 preserves full Retry-After, configuration and cancellation cause zero HTTP requests', async () => {
  let calls = 0
  const request: typeof fetch = async () => { calls++; return new Response('{}', { status: 429, headers: { 'retry-after': '3600' } }) }
  await assert.rejects(createMemeImageRenderer(config, () => {}, request)('prompt'),
    (error: { retryAfterMs?: number }) => error.retryAfterMs === 3_600_000)
  assert.equal(calls, 1)
  await assert.rejects(createMemeImageRenderer({ ...config, enabled: false }, () => {}, request)('prompt'))
  await assert.rejects(createMemeImageRenderer(config, () => {}, request)('prompt', AbortSignal.abort()))
  assert.equal(calls, 1)
})
test('assets are immutable, independently verified and not fetched from external URLs', async () => {
  const assets = createMemeAssets(memoryJsonFiles()), id = digest('job')
  const first = await assets.put(id, digest('source'), mockMemePng(), 'Alt')
  assert.equal((await assets.get(id))?.asset.sha256, first.sha256)
  await assert.rejects(assets.put(id, digest('source'), mockMemePng(99), 'Alt'), /conflict/)
  await assert.rejects(assets.get('../../file'), /invalid/)
})
