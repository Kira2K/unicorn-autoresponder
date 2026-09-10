const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { createNocoClient } = require('../../../../integrations/noco/core/client.ts')
const { TABLES } = require('../../../../integrations/noco/core/schema.ts')
const { createLinkedInAuthNocoRepository } = require('../../account-connection/noco-repository.ts')
const { createNocoGenerationRepository } = require('../generation/noco-generation-context.ts')
const { createProfileJobStore } = require('../noco-job-store.ts')

async function testNocoHttpBudget() {
  const previous = process.env.nocodb_api_token
  process.env.nocodb_api_token = 'mock-only'
  const tables: Record<string, Array<Record<string, unknown>>> = {}
  for (const table of ['platformAccounts', 'clients', 'dolphinProfiles', 'cvProcessing']) tables[TABLES[table].id] = []
  tables.jobs = []
  for (let index = 0; index <= 200; index += 1) {
    const id = index ? 1000 + index : 7
    const owner = index ? 2000 + index : 8
    tables[TABLES.platformAccounts.id].push({ Id: id, clients_id: owner, platforms_id: 16,
      url: 'https://www.linkedin.com/in/mock/', unipile_account_id: 'mock' })
    tables[TABLES.clients.id].push({ Id: owner, client_name: 'Mock' })
    tables[TABLES.dolphinProfiles.id].push({ Id: id, clients_id: owner, locale: 'En', dolphin_profile_id: id })
    tables[TABLES.cvProcessing.id].push({ Id: id, clients_id: owner, status: 'filled', en_version_url: 'mock' })
    tables.jobs.push({ Id: id, job_id: `job-${id}`, platform_account_id: id, status: 'succeeded' })
  }
  let requests = 0
  const makeClient = () => createNocoClient({ requester: async ({ url, method }: { url: string; method: string }) => {
    assert.equal(method, 'get', 'this measurement cannot write to any provider')
    requests += 1
    const parsed = new URL(url)
    if (parsed.pathname.includes('/meta/')) return { data: { list: [{ id: 'jobs', title: 'linkedin_profile_jobs' }] } }
    const table = parsed.pathname.split('/').at(-2)!
    const where = parsed.searchParams.get('where') ?? ''
    let rows = tables[table]
    for (const match of where.matchAll(/\((Id|clients_id|platform_account_id),eq,(\d+)\)/g)) {
      rows = rows.filter(row => Number(row[match[1]]) === Number(match[2]))
    }
    const offset = Number(parsed.searchParams.get('offset'))
    const limit = Number(parsed.searchParams.get('limit'))
    return { data: { list: rows.slice(offset, offset + limit), pageInfo: { isLastPage: offset + limit >= rows.length } } }
  } })
  try {
    const oldClient = makeClient()
    await createLinkedInAuthNocoRepository({ ...oldClient, wait: async () => undefined }).listAccounts()
    await oldClient.fetchRecords(TABLES.cvProcessing.id, 1000)
    await createProfileJobStore(oldClient).list()
    const before = requests
    requests = 0
    const client = makeClient()
    const repository = createLinkedInAuthNocoRepository(client)
    const account = await repository.getAccount(7)
    await createNocoGenerationRepository(repository, client).getGenerationContext(7, account)
    await createProfileJobStore(client).list(7)
    assert.equal(before, 18, 'cold whole-table reads: 3x3 account pages + 3 CV + 5 history + metadata')
    assert.equal(requests, 6, 'scoped reads: 3 account records + CV + history + metadata')
    console.log('Noco HTTP read budget (201-row mock, cold cache): 18 -> 6')
  } finally {
    if (previous === undefined) delete process.env.nocodb_api_token
    else process.env.nocodb_api_token = previous
  }
}
module.exports = { testNocoHttpBudget }
