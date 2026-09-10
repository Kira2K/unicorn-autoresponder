import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nocoFixture } from './noco-fixture.ts'
import { createPostNocoStore, tableNames } from '../noco-store.ts'
import { defaults, type History } from '../types.ts'
const history: History = { id: '203-test', account: 203, runId: 'run-test', hash: 'test',
  text: 'text', signature: 'test', status: 'sending' }

test('twenty concurrent claims create one row without a database unique constraint', async () => {
  const f = nocoFixture(), store = createPostNocoStore(f.http)
  const result = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    store.claim(history.id, { ...history, runId: `run-${i}` })))
  assert.equal(result.filter(value => value.created).length, 1)
  assert.equal(new Set(result.map(value => value.value.runId)).size, 1)
  assert.equal(f.calls.filter(value => value.method === 'POST').length, 1)
})

test('concurrent settings saves create once and verify each changed snapshot', async () => {
  const f = nocoFixture(), store = createPostNocoStore(f.http)
  await Promise.all([store.put('settings', '203', defaults(203)),
    store.put('settings', '203', { ...defaults(203), likes: true })])
  assert.equal((await store.get('settings', '203'))?.likes, true)
  assert.equal(f.calls.filter(value => value.method === 'POST').length, 1)
  assert.equal(f.calls.filter(value => value.method === 'PATCH').length, 1)
  const patchIndex = f.calls.findIndex(value => value.method === 'PATCH')
  assert.equal(f.calls[patchIndex + 1].method, 'GET')
})

test('missing ambiguous create read-back cannot cause an automatic second POST', async () => {
  const f = nocoFixture(), request = f.http.request
  let attempts = 0
  f.http.request = async (method, path, body) => {
    if (method === 'POST') { attempts++; throw new Error('lost') }
    return request(method, path, body)
  }
  const store = createPostNocoStore(f.http)
  for (let i = 0; i < 3; i++) await assert.rejects(store.claim(history.id, history), /create_uncertain/)
  assert.equal(attempts, 1)
})

test('duplicate rows block point reads, startup lists and writes; nothing is removed', async () => {
  const f = nocoFixture(), store = createPostNocoStore(f.http)
  await store.claim(history.id, history)
  const rows = f.saved.get(tableNames.history)!
  rows.push({ ...rows[0], Id: 2 })
  await assert.rejects(store.list('history'), /duplicate_rows/)
  await assert.rejects(store.get('history', history.id), /duplicate_rows/)
  await assert.rejects(store.put('history', history.id, history), /duplicate_rows/)
  assert.equal(rows.length, 2)
  assert.equal(f.calls.filter(value => value.method === 'POST').length, 1)
})

test('unconfirmed PATCH does not report a successful checkpoint', async () => {
  const f = nocoFixture(), store = createPostNocoStore(f.http)
  await store.put('settings', '203', defaults(203))
  const request = f.http.request
  f.http.request = async (method, path, body) => method === 'PATCH' ? {} : request(method, path, body)
  await assert.rejects(store.put('settings', '203', { ...defaults(203), likes: true }), /unconfirmed/)
})

test('read-back compares persisted JSON, including cleared optional fields', async () => {
  const f = nocoFixture(), store = createPostNocoStore(f.http)
  await store.claim(history.id, history)
  await store.put('history', history.id, { ...history, status: 'published', postId: 'post-1', url: undefined })
  assert.equal((await store.get('history', history.id))?.status, 'published')
  await store.put('settings', '203', { ...defaults(203), slot: undefined })
  assert.deepEqual(await store.get('settings', '203'), defaults(203))
})
