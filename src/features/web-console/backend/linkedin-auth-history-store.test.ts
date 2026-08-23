const assert = require('node:assert/strict')
const { createLinkedInAuthHistoryStore, createdId, fromRow } = require('./linkedin-auth-history-store.ts') as any

async function run() {
  const calls: any[] = []
  const client = {
    config: { baseId: 'base' },
    async request() { return { list: [{ id: 'runs', title: 'linkedin_auth_runs' }] } },
    async createRecord(_table: string, record: any) { calls.push(['create', record]); return { Id: 7 } },
    async patchRecord(_table: string, id: number, record: any) { calls.push(['patch', id, record]) },
    async fetchRecords() {
      return [{ run_id: 'stale', platform_account_id: 5, client_name: 'A', action: 'check',
        status: 'running', stage: 'queued', started_at: '2026-01-01T00:00:00.000Z' }]
    }
  }
  const store = createLinkedInAuthHistoryStore(client)
  const item = { runId: 'run-1', platformAccountId: 5, clientName: 'A', action: 'check',
    status: 'running', stage: 'queued', startedAt: '2026-01-01T00:00:00.000Z' }
  await store.start(item)
  await store.finish({ ...item, status: 'succeeded', stage: 'completed',
    finishedAt: '2026-01-01T00:00:01.000Z' })
  assert.equal(calls[0][1].run_id, 'run-1')
  assert.deepEqual(calls[1].slice(0, 2), ['patch', 7])
  assert.equal((await store.list())[0].status, 'interrupted')
  assert.equal(createdId([{ Id: 9 }]), 9)
  assert.equal(fromRow({ status: 'running' }).status, 'interrupted')
  assert.equal(JSON.stringify(calls).includes('li_at'), false)
}

run().then(() => console.log('linkedin auth history store tests passed')).catch((error: unknown) => {
  console.error(error); process.exitCode = 1
})
