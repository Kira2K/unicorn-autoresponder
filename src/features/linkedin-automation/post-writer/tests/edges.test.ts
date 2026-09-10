import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as httpModule from '../../../../integrations/unipile/http-client.ts'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'

test('turning likes off and on never resurrects the saved remaining queue', async () => {
  const f = fixture()
  await f.service.update(203, { ...defaults(203), likes: true })
  await f.service.start(203, 'automatic', 'toggle-pending')
  for (let i = 0; i < 8 && f.counts.like < 1; i++) await f.step(6000)
  assert.equal(f.counts.like, 1)
  await f.service.update(203, { ...defaults(203), likes: false })
  await f.service.update(203, { ...defaults(203), likes: true })
  for (let i = 0; i < 5; i++) await f.step(90_001)
  const run = await f.run()
  assert.equal(f.counts.like, 1)
  assert.equal(run.status, 'published')
  assert.equal(run.engagement.status, 'cancelled')
  assert.equal(run.engagement.items.filter(item => item.status === 'sent').length, 1)
})

test('Stop while identity is reading prevents the publication POST', async () => {
  const f = fixture()
  const run = await f.service.start(203, 'automatic', 'stop-identity')
  f.deps.adapter.identity = async () => { await f.service.action(run.id, 'stop') }
  await f.step()
  assert.equal(f.counts.publish, 0)
  assert.equal((await f.run()).status, 'stopped')
  assert.equal(f.held.size, 0)
})

test('failed history confirmation cannot mark post published; recovery never repeats POST', async () => {
  const f = fixture()
  const put = f.deps.store.put.bind(f.deps.store)
  f.deps.store.put = async (table, key, value) => {
    if (table === 'history' && 'status' in value && value.status === 'published') throw new Error('Noco failed')
    await put(table, key, value)
  }
  await f.service.start(203, 'automatic', 'history-persistence')
  await f.step()
  await f.step(6000)
  assert.equal((await f.run()).status, 'uncertain')
  f.deps.store.put = put
  f.restart()
  await f.step(300_000)
  assert.equal((await f.run()).status, 'published')
  assert.equal(f.counts.publish, 1)
})

test('full Retry-After and no-cache are opt-in; legacy defaults remain unchanged', async () => {
  const { createUnipileHttpClient } = httpModule as unknown as {
    createUnipileHttpClient(options: Record<string, unknown>): {
      request(method: string, path: string, body?: unknown, options?: Record<string, boolean>): Promise<unknown> }
  }
  for (const full of [false, true]) {
    const client = createUnipileHttpClient({ apiKey: 'mock', baseUrl: 'http://mock',
      fetchImpl: async (_url: string, init: RequestInit) => {
        assert.equal((init.headers as Record<string, string>)['Cache-Control'], full ? 'no-cache' : undefined)
        return new Response('{}', { status: 429, headers: { 'Retry-After': '3600' } })
      } })
    await assert.rejects(client.request('GET', '/profile', undefined, { fullRetryAfter: full, noCache: full }), (error: unknown) => {
      assert.equal((error as { details: { retryAfterMs: number } }).details.retryAfterMs, full ? 3_600_000 : 120_000)
      return true
    })
  }
})
