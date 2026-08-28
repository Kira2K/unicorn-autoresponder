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
}

run().then(() => console.log('connection pending pagination tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
