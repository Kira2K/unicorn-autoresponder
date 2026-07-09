const fs = require('node:fs')
const path = require('node:path')

const { createNocoClient } = require('../src/integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const { describeDetailedError, describeError } = require('../src/integrations/noco/core/errors.ts') as {
  describeDetailedError(error: any): Record<string, unknown>
  describeError(error: any): string
}
const { TABLES } = require('../src/integrations/noco/core/schema.ts') as {
  TABLES: Record<string, { id: string; title: string }>
}

const PLATFORM_ACCOUNTS = TABLES.platformAccounts
const CLIENTS = TABLES.clients
const RELATION_TITLE = 'rel_platformAccounts_client'
const BROKEN_RELATION_COLUMN_ID = 'c80ognlxq7uvsfd'
const REPORT_DIR = path.resolve(
  __dirname,
  '../logs/nocodb-repair',
  new Date().toISOString().replace(/[:.]/g, '-')
)

type NocoRecord = Record<string, unknown> & { Id: number }

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function writeJson(name: string, data: unknown): void {
  ensureDir(REPORT_DIR)
  fs.writeFileSync(path.join(REPORT_DIR, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function linkedId(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const record = Array.isArray(value)
    ? value.find(item => item && typeof item === 'object')
    : value
  const id = Number((record as Record<string, unknown>)?.Id ?? (record as Record<string, unknown>)?.id)
  return Number.isFinite(id) && id > 0 ? id : null
}

async function fetchAllRecords(client: any): Promise<NocoRecord[]> {
  return await client.fetchRecords(PLATFORM_ACCOUNTS.id, 1000)
}

async function deleteColumn(client: any, columnId: string): Promise<Record<string, unknown>> {
  const attempts = [
    `/api/v2/meta/columns/${columnId}`,
    `/api/v1/db/meta/columns/${columnId}`
  ]
  let lastError: any

  for (const endpoint of attempts) {
    try {
      await client.request('delete', endpoint)
      return { ok: true, endpoint }
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
        throw error
      }
    }
  }

  return { ok: false, error: describeError(lastError) }
}

async function createBelongsToRelation(client: any): Promise<Record<string, unknown> & { id?: string }> {
  const body = {
    title: RELATION_TITLE,
    column_name: RELATION_TITLE,
    uidt: 'LinkToAnotherRecord',
    type: 'bt',
    childId: PLATFORM_ACCOUNTS.id,
    parentId: CLIENTS.id
  }
  await client.request('post', `/api/v2/meta/tables/${PLATFORM_ACCOUNTS.id}/columns`, body)
  const meta = await client.fetchTableMeta(PLATFORM_ACCOUNTS.id)
  const relation = (meta.columns ?? []).find((column: any) => column.title === RELATION_TITLE)
  if (!relation?.id) {
    throw new Error(`NocoDB did not expose recreated ${RELATION_TITLE} relation id.`)
  }
  return relation
}

async function linkRecord(client: any, fieldId: string, accountId: number, clientId: number): Promise<Record<string, unknown>> {
  const bodies = [
    [{ Id: clientId }],
    { Id: clientId },
    { data: [{ Id: clientId }] }
  ]
  let lastError: any

  for (const body of bodies) {
    try {
      await client.request(
        'post',
        `/api/v2/tables/${PLATFORM_ACCOUNTS.id}/links/${fieldId}/records/${accountId}`,
        body
      )
      return { ok: true }
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
        throw error
      }
    }
  }

  return { ok: false, error: describeError(lastError) }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const apply = args.has('--apply')
  const client = createNocoClient({ requestTimeoutMs: 120000 })
  const beforeMeta = await client.fetchTableMeta(PLATFORM_ACCOUNTS.id)
  const relation = (beforeMeta.columns ?? []).find((column: any) => column.title === RELATION_TITLE)
  const records = await fetchAllRecords(client)
  const linkMap = records
    .map(record => ({
      accountId: Number(record.Id),
      clientId: linkedId(record[RELATION_TITLE])
    }))
    .filter((item): item is { accountId: number; clientId: number } =>
      Number.isFinite(item.accountId) && item.accountId > 0 && Boolean(item.clientId)
    )

  writeJson('plan.json', {
    apply,
    relation: relation
      ? {
          id: relation.id,
          title: relation.title,
          uidt: relation.uidt,
          type: relation.colOptions?.type,
          mmModelId: relation.colOptions?.fk_mm_model_id,
          createdAt: relation.colOptions?.created_at
        }
      : null,
    records: records.length,
    linksToRestore: linkMap.length
  })

  if (!apply) {
    console.log(`Dry-run written to ${REPORT_DIR}`)
    console.log(JSON.stringify({ records: records.length, linksToRestore: linkMap.length }, null, 2))
    return
  }

  if (relation?.id !== BROKEN_RELATION_COLUMN_ID || relation?.colOptions?.type !== 'mo') {
    throw new Error(`Refusing to repair unexpected relation state: ${JSON.stringify({
      id: relation?.id,
      type: relation?.colOptions?.type
    })}`)
  }
  if (linkMap.length < records.length * 0.9) {
    throw new Error(`Refusing to continue: only ${linkMap.length}/${records.length} accounts have a client link.`)
  }

  const deleteResult = await deleteColumn(client, BROKEN_RELATION_COLUMN_ID)
  if (!deleteResult.ok) {
    throw new Error(`Failed to delete broken relation column: ${JSON.stringify(deleteResult)}`)
  }
  await client.wait(1000)

  const recreated = await createBelongsToRelation(client)
  const recreatedId = recreated.id
  if (!recreatedId) throw new Error('Recreated relation has no id.')

  const linkResults = []
  for (const item of linkMap) {
    const result = await linkRecord(client, recreatedId, item.accountId, item.clientId)
    linkResults.push({ ...item, result })
    await client.wait(120)
  }

  const afterMeta = await client.fetchTableMeta(PLATFORM_ACCOUNTS.id)
  const afterRelation = (afterMeta.columns ?? []).find((column: any) => column.title === RELATION_TITLE)
  const clientsIdColumn = (afterMeta.columns ?? []).find((column: any) => column.title === 'clients_id')

  let filteredQueryResult: Record<string, unknown>
  try {
    const data = await client.request(
      'get',
      `/api/v2/tables/${PLATFORM_ACCOUNTS.id}/records?limit=1&offset=0&where=(clients_id,eq,1)`
    ) as { list?: unknown[]; data?: unknown[] }
    filteredQueryResult = { ok: true, rows: (data.list ?? data.data ?? []).length }
  } catch (error: any) {
    filteredQueryResult = { ok: false, error: describeDetailedError(error) }
  }

  const result = {
    deleteResult,
    recreated: {
      id: afterRelation?.id,
      title: afterRelation?.title,
      uidt: afterRelation?.uidt,
      type: afterRelation?.colOptions?.type,
      childColumnId: afterRelation?.colOptions?.fk_child_column_id
    },
    clientsIdColumn: clientsIdColumn
      ? {
          id: clientsIdColumn.id,
          title: clientsIdColumn.title,
          columnName: clientsIdColumn.column_name,
          uidt: clientsIdColumn.uidt
        }
      : null,
    linkResults: {
      total: linkResults.length,
      failed: linkResults.filter(item => !(item.result as any).ok)
    },
    filteredQueryResult
  }
  writeJson('apply-result.json', result)
  console.log(`Repair result written to ${REPORT_DIR}`)
  console.log(JSON.stringify({
    relationType: result.recreated.type,
    clientsIdColumn: result.clientsIdColumn,
    links: result.linkResults.total,
    failedLinks: result.linkResults.failed.length,
    filteredQueryResult
  }, null, 2))

  if (!filteredQueryResult.ok || result.linkResults.failed.length) {
    process.exitCode = 1
  }
}

main().catch((error: any) => {
  writeJson('error.json', {
    error: describeError(error),
    detail: describeDetailedError(error)
  })
  console.error(describeError(error))
  process.exit(1)
})
