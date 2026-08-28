const assert = require('node:assert/strict')
const { CONNECTION_TABLES } = require('../../../../integrations/noco/linkedin-connection-inviter-schema/logic.ts') as
  typeof import('../../../../integrations/noco/linkedin-connection-inviter-schema/logic.ts')
const { createConnectionInviterStore } = require('../noco-store.mts') as typeof import('../noco-store.mts')

const ids: Record<string, string> = { catalog: 'catalog-table', runs: 'runs-table', history: 'history-table' }
const tables = Object.entries(CONNECTION_TABLES).map(([key, definition]) =>
  ({ id: ids[key], title: definition.title }))
let capturedQuery: Record<string, unknown> = {}
const client = {
  config: { baseId: 'base' },
  async request() { return tables },
  async fetchTableMeta(tableId: string) {
    const entry = Object.entries(ids).find(([, id]) => id === tableId)
    return { columns: entry ? CONNECTION_TABLES[entry[0] as keyof typeof CONNECTION_TABLES].columns : [] }
  },
  async fetchRecords(tableId: string, _limit: number, query: Record<string, unknown>) {
    if (tableId !== ids.history) return []
    capturedQuery = query
    const row = (status: string, id: number) => ({ Id: id, history_key: `history-${id}`,
      run_id: 'run', platform_account_id: 105, unipile_account_id: 'account',
      person_id: `person-${id}`, audience: 'recruiter', search_key: 'search',
      status, discovered_at: '2026-08-28 02:00:00', updated_at: '2026-08-28 02:00:00',
      sent_at: '2026-08-28 02:00:00' })
    return [row('sent', 1), row('accepted', 2), row('ignored', 3)]
  }
}

async function run() {
  const sent = await createConnectionInviterStore(client).weekSent(105, '2026-08-24')
  assert.deepEqual(sent.map((item: any) => item.status), ['sent', 'accepted'])
  assert.equal(capturedQuery.where,
    '(platform_account_id,eq,105)~and((sent_at,ge,exactDate,2026-08-24 00:00:00))')
}
run().then(() => console.log('connection Noco store tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
