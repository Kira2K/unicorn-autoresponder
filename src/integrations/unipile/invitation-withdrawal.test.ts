import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAllSentInvitations } from './sent-invitations.ts'
import { createWithdrawalProvider } from './invitation-withdrawal.ts'
import * as httpModule from './http-client.ts'
import { fixture, finished } from '../../features/linkedin-automation/invitation-withdrawal/test-fixture.ts'
const { createUnipileHttpClient } = httpModule as unknown as { createUnipileHttpClient(options: any): any }
const row = (id: number) => ({ type: 'sent', id: `inv-${id}`, created_at: '2026-08-01T00:00:00Z',
  user: { display_name: `Person ${id}` } })
test('all pages are read, including short pages; date is returned without inference', async () => {
  const offsets: number[] = []
  const result = await readAllSentInvitations(async offset => {
    offsets.push(offset); return { data: offset < 3 ? [row(offset)] : [] }
  })
  assert.deepEqual(offsets, [0, 1, 2, 3]); assert.equal(result.length, 3)
  assert.equal(result[0].createdAt, row(0).created_at)
})
test('full large list, not only first 100 or our own sends', async () => {
  const rows = Array.from({ length: 237 }, (_, i) => row(i)), offsets: number[] = []
  const result = await readAllSentInvitations(async offset => {
    offsets.push(offset); return { data: rows.slice(offset, offset + 100), total_count: rows.length }
  })
  assert.equal(result.length, 237); assert.deepEqual(offsets, [0, 100, 200])
})
test('duplicate, received, malformed and truncated responses block a partial list', async () => {
  for (const response of [{}, { data: [row(0), row(0)] }, { data: [{ ...row(0), type: 'received' }] },
    { data: [], total_count: 5 }, { data: [row(0)], total_count: -1 }]) {
    await assert.rejects(readAllSentInvitations(async () => response))
  }
  await assert.rejects(readAllSentInvitations(async offset => ({ data: [row(offset)], total_count: offset ? 4 : 5 })))
})
test('official V2 cancel path, full Retry-After, fresh reads and no retry on failed POST', async () => {
  const calls: any[] = []
  const provider = createWithdrawalProvider({ async request(...args) {
    calls.push(args)
    if (args[0] === 'POST') throw new Error('timeout')
    return { data: [row(1)], total_count: 1 }
  } })
  assert.equal((await provider.list('acc_test'))[0].id, 'inv-1')
  await assert.rejects(provider.cancel('acc_test', 'inv/1'))
  assert.equal(calls.length, 2)
  assert.equal(calls[1][1], '/acc_test/users/me/relation-requests/inv%2F1/cancel')
  assert.deepEqual(calls[0][3], { noCache: true, fullRetryAfter: true })
})
test('provider verifies account owner before write; missing or malformed success is uncertain', async () => {
  const provider = createWithdrawalProvider({ async request() { return {} } })
  await assert.rejects(provider.verify({ accountId: 'acc_test', platformAccountId: 1, linkedinUrl: '' }))
  await assert.rejects(provider.cancel('acc_test', 'inv-1'))
})

test('only HTTP 200 with RelationRequestCanceled confirms; no response causes a second POST', async () => {
  for (const status of [200, 201, 202, 204, 404, 429, 500]) for (const body of [
    { object: 'RelationRequestCanceled' }, {}, { object: 'OperationStarted' }
  ]) {
    let calls = 0
    const http = createUnipileHttpClient({ apiKey: 'mock', fetchImpl: async () => {
      calls++; return new Response(status === 204 ? null : JSON.stringify(body), { status })
    } })
    const operation = createWithdrawalProvider(http).cancel('acc_test', 'inv-1')
    if (status === 200 && body.object === 'RelationRequestCanceled') await operation
    else await assert.rejects(operation)
    assert.equal(calls, 1)
  }
})

test('300 pending, 40 eligible: 48 physical requests with the same selected invitations', async () => {
  const f = fixture(), requests: string[] = [], canceled: string[] = []
  let rows = Array.from({ length: 300 }, (_, id) => ({ ...row(id),
    created_at: id < 40 ? '2026-08-01T00:00:00Z' : '2026-09-16T00:00:00Z' }))
  f.runtime.provider = () => createWithdrawalProvider(createUnipileHttpClient({ apiKey: 'mock',
    baseUrl: 'https://unipile.test/v2', fetchImpl: async (url: string, init: any) => {
      const path = new URL(url).pathname
      requests.push(`${init.method} ${path}`)
      let body: any
      if (path === '/v2/accounts/acc_test') body = { id: 'acc_test', provider: 'linkedin', status: 'running' }
      else if (path === '/v2/acc_test/users/me') body = { public_identifier: 'test', provider_id: 'owner' }
      else if (init.method === 'POST') {
        const id = path.split('/').at(-2)!
        canceled.push(id); rows = rows.filter(row => row.id !== id)
        body = { object: 'RelationRequestCanceled' }
      } else {
        const offset = Number(new URL(url).searchParams.get('offset'))
        body = { data: rows.slice(offset, offset + 100), total_count: rows.length }
      }
      return new Response(JSON.stringify(body), { status: 200 })
    } }))
  await f.service.start(1, (await f.service.preview(1)).token)
  const run = await finished(f.service)
  assert.equal(run?.status, 'completed'); assert.equal(run?.withdrawn, 40)
  assert.deepEqual(canceled, Array.from({ length: 40 }, (_, i) => `inv-${i}`))
  assert.equal(requests.length, 48)
  assert.equal(requests.filter(request => request.startsWith('GET')).length, 8)
  assert.equal(requests.filter(request => request.startsWith('POST')).length, 40)
})
