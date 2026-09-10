import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'
import { createPostAdapter, parsePost, type PostHttp } from '../../../../integrations/unipile/post-writer-adapter.ts'
import { PostError } from '../errors.ts'
test('V2 text + base64 attachment are one POST; read-back uses attachment ID', async () => {
  const calls: unknown[] = []
  const response = { id: 'post', text: 'Text', author: { id: 'author' },
    share_url: 'https://www.linkedin.com/feed/update/post/', created_at: new Date().toISOString(),
    attachments: [{ type: 'img', id: 'img-1', mimetype: 'image/png' }] }
  const http: PostHttp = { async request<T>(_method: string, _path: string, body?: unknown) {
    calls.push(body); return response as T
  } }
  const adapter = createPostAdapter(() => {}, http, { run: fn => fn() })
  const image = { content: 'test-base64', content_type: 'image/png' as const, filename: 'meme.png' }
  const post = await adapter.publish((await fixture().deps.source.accounts())[0], 'Text', image)
  assert.deepEqual(calls, [{ text: 'Text', can_read: 'anyone', can_comment: 'anyone', attachments: [image] }])
  assert.deepEqual(post.images, [{ id: 'img-1', available: true }])
  assert.equal(parsePost({ ...response, attachments: [{ ...response.attachments[0], is_unavailable: true }] }).images![0].available, false)
  assert.throws(() => parsePost({ ...response, attachments: {} }), /response_invalid/)
})
test('lost POST response or unavailable image remains uncertain; Stop/restart never reposts', async () => {
  for (const lostResponse of [true, false]) {
    const f = fixture(), publish = f.deps.adapter.publish
    f.deps.adapter.publish = async (...args) => {
      const post = await publish(...args)
      if (lostResponse) throw new PostError('timeout', 1000, 503)
      post.images![0].available = false
      return post
    }
    await f.service.update(203, { ...defaults(203), memes: true })
    const started = await f.service.start(203, 'automatic', 'meme-uncertain-key')
    await f.step(); await f.step(6000)
    assert.equal((await f.run()).status, 'uncertain')
    await f.service.action(started.id, 'stop')
    f.restart()
    await f.step(600_000)
    assert.equal((await f.run()).status, 'uncertain')
    assert.equal(f.counts.publish, 1)
    assert.equal(f.counts.like, 0)
  }
})
test('failed image never silently publishes text alone or regenerates after restart', async () => {
  const f = fixture()
  let images = 0
  f.deps.memes!.render = async () => { images++; throw new PostError('image_error', 3600_000, 429) }
  await f.service.update(203, { ...defaults(203), memes: true })
  await f.service.start(203, 'automatic', 'meme-error-key')
  await f.step()
  assert.equal((await f.run()).status, 'blocked')
  f.restart(); await f.step(3600_001)
  assert.equal(images, 1)
  assert.equal(f.counts.publish, 0)
})
