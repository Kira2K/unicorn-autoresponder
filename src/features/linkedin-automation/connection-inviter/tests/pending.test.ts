const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readPendingInvitations } = require('../pending-reader.ts') as typeof import('../pending-reader.ts')
const { fixture } = require('./fixtures.ts') as typeof import('./fixtures.ts')
const { invitationRuntime } = require('./invitation-test-fixtures.ts') as typeof import('./invitation-test-fixtures.ts')
const { listAllPending } = require('../pending.ts') as typeof import('../pending.ts')

test('pending pagination: offsets, cursor chains and incomplete lists', async () => {
  const offsets: number[] = []
  const pages: Record<number, any[]> = {
    0: [{ user: { id: 'one' } }, { user: { id: 'two' } }],
    2: [{ user: { id: 'three' } }], 3: []
  }
  const runtime: any = { now: () => new Date('2026-08-24T09:00:00Z'), logger: { event() {} }, adapter: () => ({
    async listPendingInvitations(_accountId: string, offset: number) {
      offsets.push(offset); return { data: pages[offset] }
    }
  }) }
  const items = await listAllPending(runtime, 'acc_test')
  assert.equal(items.length, 3)
  assert.deepEqual(offsets, [0, 2, 3])

  const cursorCalls: Array<number | string> = []
  const cursorRuntime: any = { now: () => new Date('2026-08-24T09:00:00Z'), logger: { event() {} }, adapter: () => ({
    async listPendingInvitations(_accountId: string, page: number | string) {
      cursorCalls.push(page)
      if (page === 0) return { items: [{ user_id: 'first' }], next_cursor: 'page-two' }
      return { data: { items: [{ user_id: 'target-on-page-two' }] }, total_count: 2 }
    }
  }) }
  const cursorItems = await listAllPending(cursorRuntime, 'acc_test')
  assert.deepEqual(cursorItems.map((item: any) => item.user_id),
    ['first', 'target-on-page-two'])
  assert.deepEqual(cursorCalls, [0, 'page-two'])

  const repeatedCursor: any = { now: () => new Date('2026-08-24T09:00:00Z'), logger: { event() {} }, adapter: () => ({
    async listPendingInvitations() {
      return { items: [{ user_id: 'same' }], next_cursor: 'same-cursor' }
    }
  }) }
  await assert.rejects(() => listAllPending(repeatedCursor, 'acc_test'),
    (error: any) => error.code === 'unipile_pending_pagination_invalid')

  const truncatedCursor: any = { now: () => new Date('2026-08-24T09:00:00Z'), logger: { event() {} }, adapter: () => ({
    async listPendingInvitations(_accountId: string, page: number | string = 0) {
      return page === 0
        ? { items: [{ user_id: 'pending-first' }], next_cursor: 'cursor-next', total_count: 3 }
        : { items: [{ user_id: 'pending-second' }] }
    }
  }) }
  await assert.rejects(() => listAllPending(truncatedCursor, 'acc_test'),
    (error: any) => error.code === 'unipile_pending_pagination_invalid')
})

function pages(target: string | undefined) {
  const setup = fixture()
  const ids = Array.from({ length: 121 }, (_, i) => `person-${i}`)
  const calls: (number | string)[] = []
  setup.adapter.listPendingInvitations = async (_account: string, offset: number) => {
    calls.push(offset)
    return { data: ids.slice(offset, offset + 50).map(id => ({ user: { id } })), total_count: ids.length }
  }
  return { runtime: invitationRuntime(setup), calls, target }
}

for (const [target, expectedPages, complete] of [
  ['person-0', 1, false], ['person-120', 3, true], ['missing', 3, true],
  [undefined, 3, true]
] as const) {
  test(`pending reader: ${target ?? 'full scan'}`, async () => {
    const setup = pages(target)
    const result = await readPendingInvitations(setup.runtime, 'account', target)
    assert.equal(setup.calls.length, expectedPages)
    assert.equal(result.accountId, 'account')
    assert.equal(result.complete, complete)
    assert.equal(result.personIds.has(target ?? 'missing'), Boolean(target && target !== 'missing'))
    assert.equal(result.refreshedAt, setup.runtime.now().getTime())
  })
}

test('invalid and truncated lists never prove absence', async () => {
  for (const response of [
    {}, { data: [{ id: 'request-without-person' }] },
    { data: [], total_count: 3 },
    { data: [], has_more: true },
    { data: [{ user_id: 'same' }, { user_id: 'same' }] }
  ]) {
    const setup = fixture()
    setup.adapter.listPendingInvitations = async () => response
    await assert.rejects(() => readPendingInvitations(invitationRuntime(setup), 'account', 'missing'))
  }
  const setup = fixture()
  setup.adapter.listPendingInvitations = async (_account: string, offset: number) =>
    ({ data: [{ user_id: `person-${offset}` }] })
  await assert.rejects(() => readPendingInvitations(invitationRuntime(setup), 'account', 'missing'),
    { code: 'unipile_pending_invitations_truncated' })
})

test('cursor chains validate metadata before accepting a positive result', async () => {
  const setup = fixture()
  setup.adapter.listPendingInvitations = async (_account: string, cursor: string | number) =>
    cursor === 0 ? { data: [{ user_id: 'one' }], next_cursor: 'next', total_count: 2 }
      : { data: [{ user_id: 'target' }], next_cursor: 'next', total_count: 2 }
  await assert.rejects(() => readPendingInvitations(invitationRuntime(setup), 'account', 'target'),
    { code: 'unipile_pending_pagination_invalid' })
})
