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
    async updateHistory(row: any) { patches += 1; Object.assign(existing, row) }
  }
  const claimed = await claimRunCandidate(conflictStore, item('reusable'))
  assert.equal(claimed?.status, 'sending')
  assert.equal(readbacks, 2)
  assert.equal(patches, 1)

  const staleStore = createMemoryConnectionInviterStore()
  const durable = item('already-sent')
  assert.equal(await staleStore.claimHistory(durable), true)
  durable.status = 'sent'; durable.sentAt = timestamp; durable.verifiedAt = timestamp
  await staleStore.updateHistory(durable)
  const staleQueued = { ...item('already-sent'), recordId: durable.recordId, status: 'deferred' }
  assert.equal(await claimRunCandidate(staleStore, staleQueued), undefined)
  assert.equal((await staleStore.findHistory('acc', 'already-sent'))?.status, 'sent')

  const { createConnectionInviterStore } = await import('../noco-store.mts')
  const { CONNECTION_TABLES } = await import(
    '../../../../integrations/noco/linkedin-connection-inviter-schema/logic.ts')
  const tableRows = Object.entries(CONNECTION_TABLES).map(([key, definition]) =>
    ({ id: key, title: definition.title }))
  const makeClient = (ambiguousCreate: false | 'own' | 'foreign' | 'missing' |
    'readfail2xx' | 'readfailtimeout' = false) => {
    const calls: Array<{ kind: string; table?: string; where?: string }> = []
    let created: any; let historyReads = 0
    return { calls, client: {
      config: { baseId: 'base' },
      async request(method: string, endpoint: string, body?: any) {
        if (method === 'get') return tableRows
        if (method === 'post' && endpoint.includes('/history/records')) {
          calls.push({ kind: 'post', table: 'history' })
          created = ambiguousCreate === 'missing' ? undefined : { Id: 101, ...body }
          if (ambiguousCreate === 'missing') return {}
          if (['own', 'foreign', 'readfailtimeout'].includes(String(ambiguousCreate))) {
            if (ambiguousCreate === 'foreign') created.run_id = 'other-run'
            throw Object.assign(new Error('timeout'), { code: 'noco_timeout' })
          }
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
        if (tableId === 'history') historyReads += 1
        if (tableId === 'history' && ['readfail2xx', 'readfailtimeout']
          .includes(String(ambiguousCreate)) && historyReads === 1) {
          throw Object.assign(new Error('read unavailable'), { code: 'noco_http_503' })
        }
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
  assert.deepEqual(regular.calls.map(call => call.kind), ['post', 'read'])

  const missing = makeClient('missing')
  const missingStore = createConnectionInviterStore(missing.client)
  assert.equal(await missingStore.claimHistory(item('missing-readback')), false)
  assert.deepEqual(missing.calls.filter(call => call.table === 'history').map(call => call.kind),
    ['post', 'read'])

  const ambiguous = makeClient('own')
  const ambiguousStore = createConnectionInviterStore(ambiguous.client)
  assert.equal(await ambiguousStore.claimHistory(item('ambiguous')), false)
  assert.deepEqual(ambiguous.calls.filter(call => call.table === 'history').map(call => call.kind),
    ['post', 'read'])

  const foreign = makeClient('foreign')
  const foreignStore = createConnectionInviterStore(foreign.client)
  assert.equal(await foreignStore.claimHistory(item('foreign')), false)
  assert.deepEqual(foreign.calls.filter(call => call.table === 'history').map(call => call.kind),
    ['post', 'read'])

  const delayed2xx = makeClient('readfail2xx')
  const delayed2xxStore = createConnectionInviterStore(delayed2xx.client)
  const delayedItem = item('delayed-2xx')
  await assert.rejects(() => delayed2xxStore.claimHistory(delayedItem),
    (error: any) => error.code === 'noco_http_503')
  assert.equal(await delayed2xxStore.claimHistory(delayedItem), true)
  assert.equal(delayed2xx.calls.filter(call => call.kind === 'post').length, 1)

  const delayedTimeout = makeClient('readfailtimeout')
  const delayedTimeoutStore = createConnectionInviterStore(delayedTimeout.client)
  const timeoutItem = item('delayed-timeout')
  await assert.rejects(() => delayedTimeoutStore.claimHistory(timeoutItem),
    (error: any) => error.code === 'noco_http_503')
  assert.equal(await delayedTimeoutStore.claimHistory(timeoutItem), false)
  assert.equal(delayedTimeout.calls.filter(call => call.kind === 'post').length, 1)
}

run().then(() => console.log('connection Noco efficiency tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
