const assert = require('node:assert/strict')
const { CONNECTION_SEARCH_CATALOG } = require('../../../features/linkedin-automation/connection-inviter/catalog.ts') as
  typeof import('../../../features/linkedin-automation/connection-inviter/catalog.ts')
const { CONNECTION_CATALOG_COLUMNS, CONNECTION_HISTORY_COLUMNS, CONNECTION_RUN_COLUMNS } =
  require('./columns.ts') as typeof import('./columns.ts')
const { ensureConnectionInviterSchema } = require('./logic.ts') as typeof import('./logic.ts')

function fakeNoco(honorUnique = true) {
  const tables: any[] = []
  const columns = new Map<string, any[]>()
  const records = new Map<string, any[]>()
  const storedColumn = (column: any) => honorUnique ? column : { ...column, unique: false, un: 0 }
  return {
    tables, records,
    async request(method: string, endpoint: string, body?: any) {
      if (method === 'get' && endpoint.endsWith('/tables')) return { list: tables }
      if (method === 'post' && endpoint.endsWith('/tables')) {
        const table = { id: `table-${tables.length + 1}`, title: body.title }
        tables.push(table); columns.set(table.id, body.columns.map(storedColumn)); records.set(table.id, [])
        return table
      }
      if (method === 'post' && endpoint.endsWith('/columns')) {
        const tableId = endpoint.split('/').at(-2) as string
        columns.get(tableId)?.push(storedColumn(body)); return body
      }
      if (method === 'post' && endpoint.endsWith('/records')) {
        const tableId = endpoint.split('/').at(-2) as string
        records.get(tableId)?.push(...body); return body
      }
      throw new Error(`Unexpected ${method} ${endpoint}`)
    },
    async fetchTableMeta(tableId: string) { return { columns: columns.get(tableId) ?? [] } },
    async fetchRecords(tableId: string) { return records.get(tableId) ?? [] }
  }
}

async function run() {
  const client = fakeNoco()
  const dry = await ensureConnectionInviterSchema(client, 'base', false)
  assert.equal(Object.values(dry.tables).every((table: any) => !table.exists), true)
  assert.equal(dry.catalog.missing, 400)
  const applied = await ensureConnectionInviterSchema(client, 'base', true)
  assert.equal(Object.values(applied.tables).every((table: any) => table.created), true)
  assert.equal(applied.catalog.created, CONNECTION_SEARCH_CATALOG.length)
  assert.equal(applied.catalog.readBackCount, 400)
  const repeated = await ensureConnectionInviterSchema(client, 'base', true)
  assert.equal(repeated.catalog.created, 0)
  assert.equal(client.records.get('table-1')?.length, 400)
  assert.equal(CONNECTION_CATALOG_COLUMNS.find(row => row.title === 'source_key')?.unique, true)
  assert.equal(CONNECTION_RUN_COLUMNS.find(row => row.title === 'run_key')?.unique, true)
  assert.equal(CONNECTION_HISTORY_COLUMNS.find(row => row.title === 'history_key')?.unique, true)
  await assert.rejects(() => ensureConnectionInviterSchema(fakeNoco(false), 'base', true),
    (error: any) => error.code === 'connection_inviter_unique_constraints_missing')
}

run().then(() => console.log('connection inviter schema tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
