import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAllSentInvitations } from './sent-invitations.ts'
import { createWithdrawalProvider } from './invitation-withdrawal.ts'
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
