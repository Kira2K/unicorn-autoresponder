const assert = require('node:assert/strict')
const { LINKEDIN_PROFILE_JOB_COLUMNS } = require('./columns.ts') as any
const { ensureLinkedInProfileJobsTable } = require('./logic.ts') as any

async function run() {
  let table: any
  const columns: any[] = []
  const client = {
    async request(method: string, endpoint: string, body?: any) {
      if (method === 'get') return { list: table ? [table] : [] }
      if (endpoint.endsWith('/tables')) {
        table = { id: 'profile-jobs', title: 'linkedin_profile_jobs' }
        columns.push(...body.columns)
      } else columns.push(body)
      return {}
    },
    async fetchTableMeta() { return { columns } }
  }
  const dry = await ensureLinkedInProfileJobsTable(client, 'base', false)
  assert.equal(dry.exists, false)
  assert.equal(dry.missing.length, LINKEDIN_PROFILE_JOB_COLUMNS.length)
  const applied = await ensureLinkedInProfileJobsTable(client, 'base', true)
  assert.equal(applied.created, true)
  assert.equal(columns.length, LINKEDIN_PROFILE_JOB_COLUMNS.length)
  assert.equal((await ensureLinkedInProfileJobsTable(client, 'base', true)).created, false)
}

run().then(() => console.log('linkedin profile jobs schema tests passed')).catch((error: unknown) => {
  console.error(error); process.exitCode = 1
})
