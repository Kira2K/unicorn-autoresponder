const assert = require('node:assert/strict')
const { LINKEDIN_AUTH_RUN_COLUMNS } = require('./columns.ts') as { LINKEDIN_AUTH_RUN_COLUMNS: any[] }
const { ensureLinkedInAuthRunsTable } = require('./logic.ts') as {
  ensureLinkedInAuthRunsTable(client: any, baseId: string, apply: boolean): Promise<any>
}

async function run() {
  let table: any
  const columns: any[] = []
  const client = {
    async request(method: string, endpoint: string, body?: any) {
      if (method === 'get') return { list: table ? [table] : [] }
      if (endpoint.endsWith('/tables')) {
        table = { id: 'runs-table', title: 'linkedin_auth_runs' }
        columns.push(...body.columns)
      } else columns.push(body)
      return {}
    },
    async fetchTableMeta() { return { columns } }
  }
  const dry = await ensureLinkedInAuthRunsTable(client, 'base', false)
  assert.equal(dry.exists, false)
  const applied = await ensureLinkedInAuthRunsTable(client, 'base', true)
  assert.equal(applied.created, true)
  assert.equal(columns.length, LINKEDIN_AUTH_RUN_COLUMNS.length)
  const repeated = await ensureLinkedInAuthRunsTable(client, 'base', true)
  assert.equal(repeated.created, false)
  assert.deepEqual(repeated.missing, [])
}

run().then(() => console.log('linkedin auth runs schema tests passed')).catch((error: unknown) => {
  console.error(error); process.exitCode = 1
})
