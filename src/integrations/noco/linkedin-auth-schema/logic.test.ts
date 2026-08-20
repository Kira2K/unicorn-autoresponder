const assert = require('node:assert/strict')

const {
  LINKEDIN_AUTH_COLUMNS,
  ensureLinkedInAuthSchema,
  inspectLinkedInAuthSchema
} = require('./logic.ts') as {
  LINKEDIN_AUTH_COLUMNS: ReadonlyArray<{ title: string; uidt: string }>
  ensureLinkedInAuthSchema(client: any, tableId: string, apply: boolean): Promise<any>
  inspectLinkedInAuthSchema(meta: any): any
}

async function run(): Promise<void> {
  assert.equal(inspectLinkedInAuthSchema({ columns: [] }).ok, false)

  const columns: Array<{ title: string; uidt: string }> = []
  const calls: Array<Record<string, unknown>> = []
  const client = {
    async fetchTableMeta() {
      return { columns }
    },
    async request(_method: string, endpoint: string, body: any) {
      calls.push({ endpoint, body })
      columns.push({ title: body.title, uidt: body.uidt })
      return { id: body.title }
    }
  }

  const dryRun = await ensureLinkedInAuthSchema(client, 'platform-table', false)
  assert.deepEqual(dryRun.missingBefore, LINKEDIN_AUTH_COLUMNS.map(column => column.title))
  assert.equal(calls.length, 0)

  const applied = await ensureLinkedInAuthSchema(client, 'platform-table', true)
  assert.equal(applied.ok, true)
  assert.equal(calls.length, LINKEDIN_AUTH_COLUMNS.length)
  assert(calls.every(call => String(call.endpoint).endsWith('/platform-table/columns')))

  const repeated = await ensureLinkedInAuthSchema(client, 'platform-table', true)
  assert.deepEqual(repeated.created, [])
  assert.equal(calls.length, LINKEDIN_AUTH_COLUMNS.length)
}

run()
  .then(() => console.log('linkedin auth Noco schema tests passed'))
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
