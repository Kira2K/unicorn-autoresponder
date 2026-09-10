const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { createLinkedInAuthNocoRepository } = require('../../account-connection/noco-repository.ts')
const { createNocoGenerationRepository } = require('../generation/noco-generation-context.ts')
const { createProfileJobStore } = require('../noco-job-store.ts')
const { TABLES } = require('../../../../integrations/noco/core/schema.ts')

type Query = { where?: string; sort?: string }
async function testNocoReads() {
  const calls: Array<{ table: string; query: Query; fresh?: boolean }> = []
  const client = {
    config: { baseId: 'mock' },
    async request() { return { list: [{ id: 'jobs', title: 'linkedin_profile_jobs' }] } },
    async fetchRecords(table: string, _limit: number, query: Query, options?: { fresh?: boolean }) {
      calls.push({ table, query, fresh: options?.fresh })
      if (table === TABLES.platformAccounts.id) return [{ Id: 7, platforms_id: 16, clients_id: 8,
        url: 'https://www.linkedin.com/in/mock/', unipile_account_id: 'mock',
        unipile_account_status: 'running', linkedin_last_verified_at: '2026-09-10' }]
      if (table === TABLES.clients.id) return [{ Id: 8, client_name: 'Mock' }]
      if (table === TABLES.dolphinProfiles.id) return [{ Id: 9, clients_id: 8, locale: 'En', dolphin_profile_id: 10 }]
      if (table === TABLES.cvProcessing.id) return [
        { Id: 3, clients_id: 8, status: 'filled', en_version_url: 'mock', UpdatedAt: '2026-09-10' },
        { Id: 4, clients_id: 8, status: 'draft', en_version_url: 'wrong' }]
      return [{ Id: 11, job_id: 'saved', platform_account_id: 7, status: 'running' }]
    },
    async patchRecord() {}, async wait() {}
  }
  const accounts = createLinkedInAuthNocoRepository(client)
  const row = await accounts.getAccount(7)
  assert.equal(row.platformAccountId, 7)
  assert.deepEqual(calls.map(call => call.query.where), ['(Id,eq,7)', '(Id,eq,8)', '(clients_id,eq,8)'])
  calls.length = 0
  const context = createNocoGenerationRepository(accounts, client)
  assert.equal((await context.getGenerationContext(7, row)).cvUrl, 'mock')
  assert.equal(calls.length, 1, 'reuse the supplied account; read only this student CV')
  assert.equal(calls[0].query.where, '(clients_id,eq,8)')
  calls.length = 0
  await accounts.getAccount(7, { fresh: true })
  assert.equal(calls.length, 3)
  assert.ok(calls.every(call => call.fresh), 'Apply bypasses the shared read cache')
  await assert.rejects(accounts.getAccount(NaN))
  await assert.rejects(context.getGenerationContext(99, row), /account/i)
  calls.length = 0
  const jobs = createProfileJobStore(client)
  await jobs.list(7)
  assert.equal(calls[0].query.where, '(platform_account_id,eq,7)')
  await jobs.listActive(7)
  assert.match(calls[1].query.where!, /platform_account_id,eq,7/)
  assert.match(calls[1].query.where!, /status,eq,verifying/)
  assert.equal(calls[1].fresh, true, 'a new run must not rely on cached active-job checks')
  await jobs.update('saved', { phase: 'test' })
  assert.equal(calls.length, 2, 'known row IDs do not need read-before-PATCH')
  await assert.rejects(jobs.list(-1))
}
module.exports = { testNocoReads }
