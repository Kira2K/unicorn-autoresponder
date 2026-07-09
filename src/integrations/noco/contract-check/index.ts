const assert = require('node:assert/strict')

const { createNocoClient } = require('../core/client.ts') as {
  createNocoClient(options?: any): any
}
const { describeDetailedError } = require('../core/errors.ts') as {
  describeDetailedError(error: any): Record<string, unknown>
}
const { parseJobArgs } = require('../core/job.ts') as {
  parseJobArgs(args?: string[]): { test: boolean }
}
const { createReportDir, writeJson } = require('../core/reports.ts') as {
  createReportDir(jobName: string): string
  writeJson(dir: string, fileName: string, data: unknown): void
}
const { TABLES } = require('../core/schema.ts') as {
  TABLES: Record<string, { id: string; title: string }>
}

type ContractCheck = {
  name: string
  ok: boolean
  details?: Record<string, unknown>
  error?: Record<string, unknown> | string
}

type NocoRecord = Record<string, unknown> & { Id: number }

const JOB_NAME = 'nocodb-contract-check'
const PLATFORM_ACCOUNT_CLIENT_RELATION = 'rel_platformAccounts_client'

function pass(name: string, details: Record<string, unknown> = {}): ContractCheck {
  return { name, ok: true, details }
}

function fail(name: string, error: Record<string, unknown> | string, details: Record<string, unknown> = {}): ContractCheck {
  return { name, ok: false, error, details }
}

function relationSummary(column: any): Record<string, unknown> {
  return {
    id: column?.id,
    title: column?.title,
    uidt: column?.uidt,
    type: column?.colOptions?.type,
    relatedModelId: column?.colOptions?.fk_related_model_id,
    childColumnId: column?.colOptions?.fk_child_column_id,
    mmModelId: column?.colOptions?.fk_mm_model_id
  }
}

function columnSummary(column: any): Record<string, unknown> {
  return {
    id: column?.id,
    title: column?.title,
    columnName: column?.column_name,
    uidt: column?.uidt
  }
}

function firstRecord(records: NocoRecord[]): NocoRecord | null {
  return records.find(record => Number.isFinite(Number(record.Id)) && Number(record.Id) > 0) ?? null
}

async function fetchRecordPage(
  client: any,
  tableId: string,
  query: Record<string, string | number> = {}
): Promise<NocoRecord[]> {
  const queryString = Object.entries(query)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  const data = await client.request(
    'get',
    `/api/v2/tables/${tableId}/records?limit=1&offset=0${queryString ? `&${queryString}` : ''}`
  ) as { list?: NocoRecord[]; data?: NocoRecord[] }
  return data.list ?? data.data ?? []
}

async function safeCheck(name: string, run: () => Promise<ContractCheck>): Promise<ContractCheck> {
  try {
    return await run()
  } catch (error: any) {
    return fail(name, describeDetailedError(error))
  }
}

async function checkPlatformAccountClientRelation(client: any): Promise<ContractCheck> {
  const meta = await client.fetchTableMeta(TABLES.platformAccounts.id)
  const columns = meta.columns ?? []
  const relation = columns.find((column: any) => column.title === PLATFORM_ACCOUNT_CLIENT_RELATION)
  const clientsId = columns.find((column: any) => column.title === 'clients_id')

  if (!relation) {
    return fail('platform_accounts client relation exists', 'Missing rel_platformAccounts_client relation.')
  }
  if (relation.colOptions?.type !== 'bt') {
    return fail(
      'platform_accounts client relation is belongs-to',
      'Expected rel_platformAccounts_client to be type bt.',
      { relation: relationSummary(relation) }
    )
  }
  if (relation.colOptions?.fk_related_model_id !== TABLES.clients.id) {
    return fail(
      'platform_accounts client relation points to clients',
      'Relation points to an unexpected table.',
      { relation: relationSummary(relation), expectedRelatedModelId: TABLES.clients.id }
    )
  }
  if (!clientsId) {
    return fail('platform_accounts clients_id field exists', 'Missing clients_id foreign key field.')
  }
  if (clientsId.uidt !== 'ForeignKey') {
    return fail(
      'platform_accounts clients_id is a foreign key',
      'clients_id exists but is not a ForeignKey column.',
      { clientsId: columnSummary(clientsId) }
    )
  }
  if (relation.colOptions?.fk_child_column_id !== clientsId.id) {
    return fail(
      'platform_accounts relation uses clients_id',
      'Relation child column does not match clients_id.',
      { relation: relationSummary(relation), clientsId: columnSummary(clientsId) }
    )
  }

  return pass('platform_accounts client relation contract', {
    relation: relationSummary(relation),
    clientsId: columnSummary(clientsId)
  })
}

async function checkReadableTables(client: any): Promise<ContractCheck> {
  const [clients, platformAccounts] = await Promise.all([
    fetchRecordPage(client, TABLES.clients.id),
    fetchRecordPage(client, TABLES.platformAccounts.id)
  ])
  return pass('critical Noco tables are readable', {
    clientsRows: clients.length,
    platformAccountRows: platformAccounts.length
  })
}

async function checkPlatformAccountsClientWhere(client: any): Promise<ContractCheck> {
  const clients = await fetchRecordPage(client, TABLES.clients.id)
  const clientRow = firstRecord(clients)
  if (!clientRow) {
    return fail('platform_accounts clients_id where query', 'Cannot verify query: clients table returned no rows.')
  }
  const clientId = Number(clientRow.Id)
  const records = await fetchRecordPage(client, TABLES.platformAccounts.id, {
    where: `(clients_id,eq,${clientId})`
  })
  return pass('platform_accounts clients_id where query', {
    clientId,
    rows: records.length
  })
}

async function runContractCheck(client = createNocoClient()): Promise<{
  ok: boolean
  checks: ContractCheck[]
}> {
  const checks = [
    await safeCheck('platform_accounts client relation contract', () => checkPlatformAccountClientRelation(client)),
    await safeCheck('critical Noco tables are readable', () => checkReadableTables(client)),
    await safeCheck('platform_accounts clients_id where query', () => checkPlatformAccountsClientWhere(client))
  ]
  return {
    ok: checks.every(check => check.ok),
    checks
  }
}

async function runTests(): Promise<void> {
  const btMeta = {
    columns: [
      {
        id: 'relation-column',
        title: PLATFORM_ACCOUNT_CLIENT_RELATION,
        uidt: 'LinkToAnotherRecord',
        colOptions: {
          type: 'bt',
          fk_related_model_id: TABLES.clients.id,
          fk_child_column_id: 'clients-id-column'
        }
      },
      {
        id: 'clients-id-column',
        title: 'clients_id',
        column_name: 'clients_id',
        uidt: 'ForeignKey'
      }
    ]
  }
  const badMeta = {
    columns: [
      {
        id: 'relation-column',
        title: PLATFORM_ACCOUNT_CLIENT_RELATION,
        uidt: 'LinkToAnotherRecord',
        colOptions: {
          type: 'mo',
          fk_related_model_id: TABLES.clients.id,
          fk_child_column_id: 'id-column',
          fk_mm_model_id: 'm2m'
        }
      }
    ]
  }

  const goodClient = {
    fetchTableMeta: async () => btMeta,
    request: async (_method: string, endpoint: string) => ({
      list: endpoint.includes(TABLES.clients.id)
        ? [{ Id: 1 }]
        : [{ Id: 10, clients_id: 1 }]
    })
  }
  const badClient = {
    fetchTableMeta: async () => badMeta,
    request: async () => ({ list: [{ Id: 1 }] })
  }

  const good = await runContractCheck(goodClient)
  assert.equal(good.ok, true)
  assert.equal(good.checks.every((check: ContractCheck) => check.ok), true)

  const bad = await runContractCheck(badClient)
  assert.equal(bad.ok, false)
  assert.equal(bad.checks[0].ok, false)
  assert.match(String(bad.checks[0].error), /Expected rel_platformAccounts_client/)
}

async function main(): Promise<void> {
  const args = parseJobArgs()
  if (args.test) {
    await runTests()
    console.log('noco:contract-check tests passed')
    return
  }

  const report = await runContractCheck()
  const dir = createReportDir(JOB_NAME)
  writeJson(dir, 'summary.json', report)
  console.log(`NocoDB contract check written to ${dir}`)
  console.log(JSON.stringify({
    ok: report.ok,
    checks: report.checks.map(check => ({
      name: check.name,
      ok: check.ok,
      error: check.error
    }))
  }, null, 2))

  if (!report.ok) {
    process.exitCode = 1
  }
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(JSON.stringify(describeDetailedError(error), null, 2))
    process.exit(1)
  })
}

module.exports = {
  checkPlatformAccountClientRelation,
  fetchRecordPage,
  runContractCheck,
  runTests
}
