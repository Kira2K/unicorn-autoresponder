const assert = require('node:assert/strict')
const { LINKEDIN_COMMENT_MONITOR_COLUMNS: columns } = require('./columns.ts') as typeof import('./columns.ts')
const { ensureLinkedInCommentMonitorTable } = require('./logic.ts') as typeof import('./logic.ts')
const { monitorJobRow } = require('../../../features/linkedin-automation/comment-monitor/job-row.ts') as
  typeof import('../../../features/linkedin-automation/comment-monitor/job-row.ts')

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
  const row = monitorJobRow({ jobId: 'job', platformAccountId: 1, accountId: 'account',
    clientName: 'Student', status: 'starting', stage: 'queued', state: {},
    expiresAt: '2026-08-27T00:00:00.000Z', createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z' } as any)
  assert.equal(row.next_check_at, null)
  assert.equal(row.last_check_at, null)
  assert.equal(row.finished_at, null)
  assert.equal(row.author_headline, null)
  assert.equal(row.author_about, null)

  const added: any[] = []
  const upgradeClient = {
    async request(method: string, _path: string, body?: any) {
      if (method === 'post') added.push(body)
      return { list: [{ id: 'comments', title: 'linkedin_comment_monitor_jobs' }] }
    },
    async fetchTableMeta() { return { columns: [...columns.slice(0, -4), ...added] } }
  }
  const upgrade = await ensureLinkedInCommentMonitorTable(upgradeClient, 'base', false)
  assert.deepEqual(upgrade.missing, ['author_headline', 'author_about',
    'author_context_fetched_at', 'author_context_status'])
  await ensureLinkedInCommentMonitorTable(upgradeClient, 'base', true)
  assert.equal(added.length, 4)
  await ensureLinkedInCommentMonitorTable(upgradeClient, 'base', true)
  assert.equal(added.length, 4)
}

run().then(() => console.log('linkedin comment monitor schema tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
