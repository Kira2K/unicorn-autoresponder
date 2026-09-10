import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nocoFixture } from './noco-fixture.ts'
import { createPostNocoStore } from '../noco-store.ts'
import type { History } from '../types.ts'
import { ensurePostSchema } from '../../../../integrations/noco/linkedin-post-writer-schema/logic.ts'
const claim: History = { id: '203-hash', account: 203, runId: 'run-1', hash: 'hash',
  text: 'text', signature: 'signature', status: 'sending' }
test('serialized claim reuses existing rows; ambiguous POST requires read-back, never another POST', async () => {
  const f = nocoFixture(), store = createPostNocoStore(f.http)
  assert.equal((await store.claim(claim.id, claim)).created, true)
  const second = await store.claim(claim.id, { ...claim, runId: 'other-run' })
  assert.equal(second.created, false)
  assert.equal(second.value.runId, 'run-1')
  f.setTimeout(true)
  const ambiguous = await store.claim('203-other', { ...claim, id: '203-other' })
  assert.equal(ambiguous.created, false)
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 2)
  assert.equal(f.saved.get('linkedin_post_history')?.length, 2)
})
test('schema dry-run performs no writes and reports missing columns', async () => {
  const f = nocoFixture()
  const request = f.http.request
  f.http.request = async (method, path, body) => path.includes('/meta/tables/')
    ? { columns: [] } : request(method, path, body)
  const result = await ensurePostSchema(f.http, false)
  assert.equal(result.length, 3)
  assert.ok(result.every(row => row.missing.includes('state_json')))
  assert.ok(f.calls.every(call => call.method === 'GET'))
})
test('incomplete schema still blocks runtime without any writes', async () => {
  const f = nocoFixture(), request = f.http.request
  f.http.request = async (method, path, body) => path.includes('/meta/tables/')
    ? { columns: [{ title: 'record_key', un: true, unique: false }] } : request(method, path, body)
  await assert.rejects(createPostNocoStore(f.http).claim(claim.id, claim), /schema_incomplete/)
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0)
})
