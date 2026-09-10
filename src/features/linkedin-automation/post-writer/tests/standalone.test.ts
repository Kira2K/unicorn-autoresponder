import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startStandalone } from '../standalone.ts'
test('standalone HTTP has independent authentication, mock generation and no publish route', async () => {
  const token = 'isolated-mock-token-for-standalone-test'
  const server = await startStandalone({ LINKEDIN_POST_TEXT_MOCK: 'true', LINKEDIN_POST_TEXT_PORT: '0',
    LINKEDIN_POST_TEXT_TOKEN: token })
  try {
    const port = (server.server.address() as { port: number }).port
    const root = `http://127.0.0.1:${port}/api/post-writer/text`
    assert.equal((await fetch(root)).status, 401)
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const initial = await (await fetch(root, { headers })).json()
    assert.equal(initial.authors.length, 0)
    const save = await fetch(`${root}/authors/test-author`, { method: 'PUT', headers, body: JSON.stringify({
      author: { name: 'Test', role: 'Engineer', stack: ['Go'], memes: true }, cv: { mimeType: 'application/pdf',
        data: Buffer.from('%PDF-1.7 mock fixture').toString('base64') } }) })
    assert.equal(save.status, 200)
    const start = await fetch(`${root}/authors/test-author/jobs`, { method: 'POST', headers,
      body: JSON.stringify({ requestKey: 'standalone-mock-key' }) })
    assert.equal(start.status, 202)
    let status = ''
    for (let i = 0; i < 30 && status !== 'ready'; i++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      status = (await (await fetch(root, { headers })).json()).jobs[0].status
    }
    assert.equal(status, 'ready')
    const job = (await (await fetch(root, { headers })).json()).jobs[0]
    assert.equal(job.meme.status, 'ready')
    assert.equal(job.meme.imageCalls, 1)
    const imageUrl = `${root}/jobs/${job.id}/meme`
    assert.equal((await fetch(imageUrl)).status, 401)
    const image = await fetch(imageUrl, { headers })
    assert.equal(image.status, 200)
    assert.match(image.headers.get('Content-Type')!, /image\/png/)
    assert.equal(image.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.equal(Buffer.from(await image.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal((await fetch(`${root}/publish`, { method: 'POST', headers })).status, 404)
  } finally { await server.close() }
})
