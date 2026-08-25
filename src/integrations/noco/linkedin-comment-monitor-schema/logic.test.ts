const assert = require('node:assert/strict')
const { LINKEDIN_COMMENT_MONITOR_COLUMNS: columns } = require('./columns.ts') as typeof import('./columns.ts')
const { ensureLinkedInCommentMonitorTable } = require('./logic.ts') as typeof import('./logic.ts')

async function run() {
  let table: any
  const client = {
    async request(method: string, _path: string, body?: any) {
      if (method === 'post' && body?.title) table = { id: 'comments', title: body.title }
      return { list: table ? [table] : [] }
    },
    async fetchTableMeta() { return { columns: columns } }
  }
  assert.equal((await ensureLinkedInCommentMonitorTable(client, 'base', false)).exists, false)
  const applied = await ensureLinkedInCommentMonitorTable(client, 'base', true)
  assert.equal(applied.created, true)
  assert.deepEqual(applied.missing, [])
  const repeated = await ensureLinkedInCommentMonitorTable(client, 'base', true)
  assert.equal(repeated.created, false)
  assert.deepEqual(repeated.missing, [])
}

run().then(() => console.log('linkedin comment monitor schema tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
