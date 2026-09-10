import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPostNocoTransport } from '../noco-transport.ts'

test('critical Noco reads disable cache; a failed HTTP POST is never retried by transport', async () => {
  const previous = process.env.NOCODB_API_TOKEN
  process.env.NOCODB_API_TOKEN = 'mock-only'
  let requests = 0
  try {
    const http = createPostNocoTransport(() => undefined, async (_url, init) => {
      requests++
      const headers = init?.headers as Record<string, string>
      if (init?.method === 'GET') {
        assert.equal(headers['Cache-Control'], 'no-cache')
        return new Response('{}')
      }
      return new Response('{}', { status: 503 })
    })
    await http.request('GET', '/mock')
    await assert.rejects(http.request('POST', '/mock', {}), /post_noco_error/)
    assert.equal(requests, 2)
  } finally {
    if (previous === undefined) delete process.env.NOCODB_API_TOKEN
    else process.env.NOCODB_API_TOKEN = previous
  }
})
