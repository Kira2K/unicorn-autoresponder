import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { createPostAdapter } from '../../../../integrations/unipile/post-writer-adapter.ts'
import { mockMemePng } from '../meme-mock.ts'
import { inspectMemeImage } from '../meme-image.ts'
import { fixture } from './helpers.ts'
import { contentHash } from '../content-identity.ts'
const { createUnipileHttpClient } = createRequire(`${process.cwd()}/package.json`)('./src/integrations/unipile/http-client.ts')

function largePng() {
  const png = mockMemePng(), length = Buffer.alloc(4), checksum = Buffer.alloc(4)
  const pixels = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)))
  const compressed = deflateSync(pixels, { level: 0 })
  const payload = Buffer.concat([Buffer.from('IDAT'), compressed])
  length.writeUInt32BE(compressed.length); checksum.writeUInt32BE(crc32(payload))
  return Buffer.concat([png.subarray(0, 33), length, payload, checksum, png.subarray(-12)])
}

test('large PNG reaches V2 as original bytes with a native multipart boundary, not base64', async () => {
  const png = largePng(), text = 'Готовый пост 🪿\nSame text, same image.'
  assert.ok(inspectMemeImage(png).byteLength > 3 * 1024 * 1024)
  const events: unknown[] = [], requests: Request[] = []
  const client = createUnipileHttpClient({ apiKey: 'private-test-key', baseUrl: 'https://unipile.test/v2',
    fetchImpl: async (url: string, init: RequestInit) => {
      assert.equal((init.body as FormData).get('text'), text)
      const request = new Request(url, init)
      requests.push(request)
      return new Response(JSON.stringify({ id: 'post', text, author: { id: 'author' },
        share_url: 'https://www.linkedin.com/feed/update/post/', created_at: new Date().toISOString(),
        attachments: [{ type: 'img', id: 'image', mimetype: 'image/png' }] }))
    } })
  const adapter = createPostAdapter((...event) => { events.push(event) }, client, { run: fn => fn() })
  const account = (await fixture().deps.source.accounts())[0]
  const result = await adapter.publish(account, text,
    { content: png.toString('base64'), content_type: 'image/png', filename: 'мем.png' })
  assert.equal(requests.length, 1)
  const request = requests[0]
  assert.equal(request.url, `https://unipile.test/v2/${encodeURIComponent(account.unipileAccountId)}/posts`)
  assert.equal(request.method, 'POST')
  assert.match(request.headers.get('content-type')!, /^multipart\/form-data; boundary=.+/)
  assert.equal(request.headers.get('x-api-key'), 'private-test-key')
  const wire = Buffer.from(await request.clone().arrayBuffer())
  assert.ok(wire.length < png.length + 2048)
  assert.ok(wire.length < Buffer.byteLength(png.toString('base64')))
  const form = await request.formData(), file = form.get('attachments[0]') as File
  // Native multipart normalizes line endings; the existing read-back hash accepts both.
  assert.equal(form.get('text'), text.replace(/\n/g, '\r\n'))
  assert.equal(contentHash(String(form.get('text'))), contentHash(text))
  assert.equal(form.get('can_read'), 'anyone')
  assert.equal(form.get('can_comment'), 'anyone')
  assert.equal(form.has('post_as'), false)
  assert.equal(file.name, 'мем.png')
  assert.equal(file.type, 'image/png')
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), png)
  assert.deepEqual(result.images, [{ id: 'image', available: true }])
  assert.doesNotMatch(JSON.stringify(events), /private-test-key|Готовый пост|Same text/)
})

test('multipart failures never retry POST, fall back to JSON or drop the image', async () => {
  for (const mode of ['413', '429', '503', 'disconnect', 'timeout']) {
    let calls = 0
    const client = createUnipileHttpClient({ apiKey: 'test', timeoutMs: 5,
      fetchImpl: async (_url: string, init: RequestInit) => {
        calls++
        assert.ok(init.body instanceof FormData)
        assert.ok(init.body.get('attachments[0]') instanceof Blob)
        if (mode === 'disconnect') throw new Error('connection lost')
        if (mode === 'timeout') return new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true })
        })
        return new Response(JSON.stringify({ type: mode === '413' ? 'provider/content_too_large' : 'api/error',
          req_id: 'request-123' }), { status: Number(mode), headers: { 'Retry-After': '600' } })
      } })
    const adapter = createPostAdapter(() => {}, client, { run: fn => fn() })
    await assert.rejects(adapter.publish((await fixture().deps.source.accounts())[0], 'Text',
      { content: mockMemePng().toString('base64'), content_type: 'image/png', filename: 'meme.png' }),
    (error: any) => {
      if (mode === 'disconnect' || mode === 'timeout') {
        assert.equal(error.code, mode === 'timeout' ? 'unipile_timeout' : 'unipile_unreachable')
      } else {
        assert.equal(error.details.httpStatus, Number(mode))
        assert.equal(error.details.requestId, 'request-123')
        assert.equal(error.details.retryAfterMs, 600_000)
        if (mode === '413') assert.equal(error.code, 'unipile_provider_content_too_large')
      }
      return true
    })
    assert.equal(calls, 1, mode)
  }
})
