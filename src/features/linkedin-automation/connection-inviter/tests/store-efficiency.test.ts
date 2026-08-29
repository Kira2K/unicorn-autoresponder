const assert = require('node:assert/strict')
const { claimRunCandidate } = require('../history-claim.ts') as typeof import('../history-claim.ts')
const { createMemoryConnectionInviterStore } = require('../memory-store.ts') as
  typeof import('../memory-store.ts')

const timestamp = '2026-08-29T09:00:00.000Z'
const item = (personId: string): any => ({ historyKey: `acc:${personId}`, runId: 'run',
  platformAccountId: 7, accountId: 'acc', personId, audience: 'recruiter', searchKey: 'search',
  name: `Person ${personId}`, headline: 'Recruiter', location: '', status: 'sending',
  reasonCode: 'invitation_claimed', discoveredAt: timestamp, updatedAt: timestamp })

async function run() {
  const store = createMemoryConnectionInviterStore()
  for (let index = 0; index < 21; index += 1) {
    assert.equal(await store.claimHistory(item(`person-${index}`)), true)
  }
  let before = store.requestStats()
  assert.equal((await store.findHistoryBatch('acc',
    Array.from({ length: 20 }, (_, index) => `person-${index}`))).length, 20)
  let after = store.requestStats()
  assert.equal(after.pages - before.pages, 1)

  before = after
  assert.equal((await store.findHistoryBatch('acc',
    Array.from({ length: 21 }, (_, index) => `person-${index}`))).length, 21)
  after = store.requestStats()
  assert.equal(after.pages - before.pages, 2)

  const existing = item('reusable')
  existing.status = 'eligible'; existing.recordId = 99
  let readbacks = 0; let patches = 0
  const conflictStore = {
    async claimHistory() { return false },
    async findHistory() { readbacks += 1; return structuredClone(existing) },
    async updateHistory() { patches += 1 }
  }
  const claimed = await claimRunCandidate(conflictStore, item('reusable'))
  assert.equal(claimed?.status, 'sending')
  assert.equal(readbacks, 1)
  assert.equal(patches, 1)

  const { createConnectionInviterStore } = await import('../noco-store.mts')
  const { CONNECTION_TABLES } = await import(
    '../../../../integrations/noco/linkedin-connection-inviter-schema/logic.ts')
  const tableRows = Object.entries(CONNECTION_TABLES).map(([key, definition]) =>
    ({ id: key, title: definition.title }))
  const makeClient = (ambiguousCreate = false) => {
    const calls: Array<{ kind: string; table?: string; where?: string }> = []
    let created: any
    return { calls, client: {
      config: { baseId: 'base' },
      async request(method: string, endpoint: string, body?: any) {
        if (method === 'get') return tableRows
        if (method === 'post' && endpoint.includes('/history/records')) {
          calls.push({ kind: 'post', table: 'history' }); created = { Id: 101, ...body }
          if (ambiguousCreate) throw Object.assign(new Error('timeout'), { code: 'noco_timeout' })
          return { Id: 101 }
        }
        throw new Error(`Unexpected request ${method} ${endpoint}`)
      },
      async fetchTableMeta(tableId: string) {
        const definition = (CONNECTION_TABLES as any)[tableId]
        return { columns: definition.columns }
      },
      async fetchRecords(tableId: string, _limit: number, query: any = {}) {
        calls.push({ kind: 'read', table: tableId, where: query.where })
        if (tableId === 'catalog') return [{ source_key: 'r', audience: 'recruiter', city: 'Berlin',
          keyword_template: 'Recruiter Berlin', priority: 1, enabled: true }]
        if (tableId === 'history' && created && String(query.where).includes(created.history_key)) {
          return [created]
        }
        return []
      },
      async createRecord() { throw new Error('not used') },
      async patchRecord() { return {} }
    } }
  }

  const regular = makeClient()
  const nocoStore = createConnectionInviterStore(regular.client)
  await Promise.all([nocoStore.listCatalog(), nocoStore.listCatalog(), nocoStore.listCatalog()])
  assert.equal(regular.calls.filter(call => call.table === 'catalog').length, 1)
  regular.calls.length = 0
  await nocoStore.findHistoryBatch('acc', Array.from({ length: 40 }, (_, index) => `p-${index}`))
  const batches = regular.calls.filter(call => call.table === 'history')
  assert.equal(batches.length, 2)
  assert.equal(batches.every(call => (call.where?.match(/history_key/g) || []).length === 20), true)
  regular.calls.length = 0
  assert.equal(await nocoStore.claimHistory(item('create-first')), true)
  assert.deepEqual(regular.calls.map(call => call.kind), ['post'])

  const ambiguous = makeClient(true)
  const ambiguousStore = createConnectionInviterStore(ambiguous.client)
  assert.equal(await ambiguousStore.claimHistory(item('ambiguous')), false)
  assert.deepEqual(ambiguous.calls.filter(call => call.table === 'history').map(call => call.kind),
    ['post', 'read'])
}

run().then(() => console.log('connection Noco efficiency tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
