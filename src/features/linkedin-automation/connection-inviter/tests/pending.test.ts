const assert = require('node:assert/strict')
const { listAllPending } = require('../pending.ts') as typeof import('../pending.ts')

async function run() {
  const offsets: number[] = []
  const pages: Record<number, any[]> = {
    0: [{ user: { id: 'one' } }, { user: { id: 'two' } }],
    2: [{ user: { id: 'three' } }], 3: []
  }
  const runtime: any = { logger: { event() {} }, adapter: () => ({
    async listPendingInvitations(_accountId: string, offset: number) {
      offsets.push(offset); return { data: pages[offset] }
    }
  }) }
  const items = await listAllPending(runtime, 'acc_test')
  assert.equal(items.length, 3)
  assert.deepEqual(offsets, [0, 2, 3])

  const cursorCalls: Array<number | string> = []
  const cursorRuntime: any = { logger: { event() {} }, adapter: () => ({
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

  const repeatedCursor: any = { logger: { event() {} }, adapter: () => ({
    async listPendingInvitations() {
      return { items: [{ user_id: 'same' }], next_cursor: 'same-cursor' }
    }
  }) }
  await assert.rejects(() => listAllPending(repeatedCursor, 'acc_test'),
    (error: any) => error.code === 'unipile_pending_pagination_invalid')

  const truncatedCursor: any = { logger: { event() {} }, adapter: () => ({
    async listPendingInvitations(_accountId: string, page: number | string = 0) {
      return page === 0
        ? { items: [{ user_id: 'pending-first' }], next_cursor: 'cursor-next', total_count: 3 }
        : { items: [{ user_id: 'pending-second' }] }
    }
  }) }
  await assert.rejects(() => listAllPending(truncatedCursor, 'acc_test'),
    (error: any) => error.code === 'unipile_pending_pagination_invalid')
}

run().then(() => console.log('connection pending pagination tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
