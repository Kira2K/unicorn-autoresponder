const fs = require('node:fs')
const path = require('node:path')
const axios = require('axios')
require('dotenv').config({ quiet: true })

type NocoRecord = Record<string, unknown> & { Id: number }

type TableConfig = {
  key: string
  id: string
  title: string
}

type MarketPatch = {
  tableKey: string
  tableId: string
  recordId: number
  before: unknown
  after: 'ru' | 'en' | 'both'
  label: string
}

type MarketLink = {
  tableKey: string
  tableId: string
  relationName: string
  recordId: number
  market: 'ru' | 'en' | 'both'
  marketRecordId: number
}

const BASE_URL = (
  process.env.NOCODB_BASE_URL ||
  process.env.nocodb_base_url ||
  'https://app.nocodb.com'
).replace(/\/+$/, '')
const TOKEN = process.env.nocodb_api_token || process.env.NOCODB_API_TOKEN
const BASE_ID = process.env.NOCODB_BASE_ID || 'pqe5susktrsa9z3'

const MARKET_VALUES = ['ru', 'en', 'both'] as const

const MARKET_SOURCE_TABLES: TableConfig[] = [
  {
    key: 'clients',
    id: 'mxza381054ldlza',
    title: 'clients'
  },
  {
    key: 'applications',
    id: 'mqgr5lv9raft8fm',
    title: 'applications_from_otkliki'
  },
  {
    key: 'restrictions',
    id: 'm7bhicp99zq1wsg',
    title: 'client_company_restrictions_from_stop_companies'
  }
]

function assertConfig(): void {
  if (!TOKEN) {
    throw new Error('Missing nocodb_api_token in environment')
  }
}

function headers(): Record<string, string> {
  return {
    'xc-token': TOKEN as string,
    'Content-Type': 'application/json'
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function nocoRequest<T>(
  method: 'get' | 'post' | 'patch',
  endpoint: string,
  body?: unknown
): Promise<T> {
  const delays = [0, 2500, 5000, 10000, 20000]
  let lastError: any

  for (const delay of delays) {
    if (delay) {
      await wait(delay)
    }

    try {
      const response = await axios.request({
        method,
        url: `${BASE_URL}${endpoint}`,
        data: body,
        headers: headers(),
        timeout: 60000
      })
      return response.data
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      const message =
        error?.response?.data?.message ?? error?.response?.data?.msg ?? error.message
      if (status !== 429 && !String(message).includes('Too Many Requests')) {
        throw error
      }
    }
  }

  throw lastError
}

async function fetchTables(): Promise<any[]> {
  const data = await nocoRequest<{ list?: any[] }>(
    'get',
    `/api/v2/meta/bases/${BASE_ID}/tables`
  )
  return data.list ?? []
}

async function fetchTableMeta(tableId: string): Promise<any> {
  return nocoRequest('get', `/api/v2/meta/tables/${tableId}`)
}

async function fetchRecords(tableId: string): Promise<NocoRecord[]> {
  const records: NocoRecord[] = []
  const limit = 100
  let offset = 0

  while (true) {
    const data = await nocoRequest<{ list?: NocoRecord[]; pageInfo?: { isLastPage?: boolean } }>(
      'get',
      `/api/v2/tables/${tableId}/records?limit=${limit}&offset=${offset}`
    )
    const list = data.list ?? []
    records.push(...list)

    if (data.pageInfo?.isLastPage || list.length < limit) {
      break
    }

    offset += limit
  }

  return records
}

function normalizeMarket(value: unknown): 'ru' | 'en' | 'both' | '' {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\\|,+]+/g, '/')

  if (!normalized) {
    return ''
  }

  if (normalized === 'ru' || normalized === 'ру') {
    return 'ru'
  }
  if (normalized === 'en' || normalized === 'eng') {
    return 'en'
  }
  if (
    normalized === 'both' ||
    normalized === 'ru/en' ||
    normalized === 'en/ru' ||
    normalized === 'ruen' ||
    normalized === 'enru'
  ) {
    return 'both'
  }

  return ''
}

function recordLabel(record: NocoRecord): string {
  return String(
    record.client_name ??
      record.raw_client_name ??
      record.company_name ??
      record.Id
  )
}

async function createMarketTable(): Promise<TableConfig> {
  const existing = (await fetchTables()).find(
    table => String(table.title ?? table.table_name ?? '').toLowerCase() === 'market'
  )

  if (existing?.id) {
    return {
      key: 'market',
      id: existing.id,
      title: existing.title ?? 'market'
    }
  }

  const attempts = [
    {
      endpoint: `/api/v2/meta/bases/${BASE_ID}/tables`,
      body: {
        title: 'market',
        table_name: 'market',
        columns: [
          {
            title: 'market',
            column_name: 'market',
            uidt: 'SingleLineText',
            pv: true
          }
        ]
      }
    },
    {
      endpoint: `/api/v1/db/meta/projects/${BASE_ID}/tables`,
      body: {
        title: 'market',
        table_name: 'market',
        columns: [
          {
            title: 'market',
            column_name: 'market',
            uidt: 'SingleLineText',
            pv: true
          }
        ]
      }
    }
  ]
  let lastError: any

  for (const attempt of attempts) {
    try {
      await nocoRequest('post', attempt.endpoint, attempt.body)
      const created = (await fetchTables()).find(
        table => String(table.title ?? table.table_name ?? '').toLowerCase() === 'market'
      )
      if (created?.id) {
        return {
          key: 'market',
          id: created.id,
          title: created.title ?? 'market'
        }
      }
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
        throw error
      }
    }
  }

  throw lastError
}

async function ensureMarketColumnOnly(table: TableConfig): Promise<unknown> {
  const meta = await fetchTableMeta(table.id)
  const marketColumn = (meta.columns ?? []).find((column: any) => column.title === 'market')
  if (marketColumn) {
    return { ok: true, existing: true, id: marketColumn.id }
  }

  const titleColumn = (meta.columns ?? []).find(
    (column: any) => column.title === 'Title' || column.column_name === 'title'
  )

  if (!titleColumn?.id) {
    const created = await nocoRequest<any>('post', `/api/v2/meta/tables/${table.id}/columns`, {
      title: 'market',
      column_name: 'market',
      uidt: 'SingleLineText'
    })
    return { ok: true, existing: false, id: created?.id }
  }

  const attempts = [
    {
      endpoint: `/api/v2/meta/columns/${titleColumn.id}`,
      body: { title: 'market', column_name: 'market' }
    },
    {
      endpoint: `/api/v1/db/meta/columns/${titleColumn.id}`,
      body: { title: 'market', column_name: 'market' }
    }
  ]
  let lastError: any

  for (const attempt of attempts) {
    try {
      await nocoRequest('patch', attempt.endpoint, attempt.body)
      return { ok: true, existing: false, renamedFrom: titleColumn.title }
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
        throw error
      }
    }
  }

  return {
    ok: false,
    error: lastError?.response?.data?.message ?? lastError?.response?.data?.msg ?? lastError.message
  }
}

async function createRecord(tableId: string, record: Record<string, unknown>): Promise<void> {
  const attempts = [
    { endpoint: `/api/v2/tables/${tableId}/records`, body: record },
    { endpoint: `/api/v2/tables/${tableId}/records`, body: [record] }
  ]
  let lastError: any

  for (const attempt of attempts) {
    try {
      await nocoRequest('post', attempt.endpoint, attempt.body)
      return
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
        throw error
      }
    }
  }

  throw lastError
}

async function ensureMarketRows(table: TableConfig): Promise<Record<'ru' | 'en' | 'both', number>> {
  const rows = await fetchRecords(table.id)
  const byMarket = new Map<string, NocoRecord>()

  for (const row of rows) {
    const market = normalizeMarket(row.market)
    if (market) {
      byMarket.set(market, row)
    }
  }

  for (const value of MARKET_VALUES) {
    if (!byMarket.has(value)) {
      await createRecord(table.id, { market: value })
      await wait(120)
    }
  }

  const updatedRows = await fetchRecords(table.id)
  const result = {} as Record<'ru' | 'en' | 'both', number>

  for (const value of MARKET_VALUES) {
    const row = updatedRows.find(record => normalizeMarket(record.market) === value)
    if (!row) {
      throw new Error(`Market row "${value}" was not created.`)
    }
    result[value] = row.Id
  }

  return result
}

async function patchRecord(tableId: string, recordId: number, patch: Record<string, unknown>): Promise<void> {
  const payload = { Id: recordId, ...patch }
  const attempts = [
    { endpoint: `/api/v2/tables/${tableId}/records`, body: payload },
    { endpoint: `/api/v2/tables/${tableId}/records`, body: [payload] },
    { endpoint: `/api/v2/tables/${tableId}/records/${recordId}`, body: patch }
  ]
  let lastError: any

  for (const attempt of attempts) {
    try {
      await nocoRequest('patch', attempt.endpoint, attempt.body)
      return
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
        throw error
      }
    }
  }

  throw lastError
}

function relationTitle(tableKey: string): string {
  if (tableKey === 'clients') {
    return 'market'
  }
  return `rel_${tableKey}_market`
}

function rawMarketValue(record: NocoRecord, tableKey: string): unknown {
  if (tableKey === 'clients' && record.market && typeof record.market === 'object') {
    return (record.market as Record<string, unknown>).market
  }
  return record.market
}

function existingLinkedMarketIds(record: NocoRecord, relationName: string): Set<number> {
  const relationValue = record[relationName]
  const values = Array.isArray(relationValue)
    ? relationValue
    : relationValue && typeof relationValue === 'object'
      ? [relationValue]
      : []

  return new Set(
    values
      .map(value => Number((value as Record<string, unknown>)?.Id))
      .filter(id => Number.isFinite(id) && id > 0)
  )
}

async function ensureMarketRelationField(
  sourceTable: TableConfig,
  marketTable: TableConfig
): Promise<{ ok: boolean; id?: string; existing: boolean; error?: string }> {
  const title = relationTitle(sourceTable.key)
  const meta = await fetchTableMeta(sourceTable.id)
  const existing = (meta.columns ?? []).find((column: any) => column.title === title)

  if (existing?.id) {
    return { ok: true, id: existing.id, existing: true }
  }

  try {
    await nocoRequest('post', `/api/v2/meta/tables/${sourceTable.id}/columns`, {
      title,
      column_name: title,
      uidt: 'LinkToAnotherRecord',
      type: 'bt',
      childId: sourceTable.id,
      parentId: marketTable.id
    })
    const updatedMeta = await fetchTableMeta(sourceTable.id)
    const createdColumn = (updatedMeta.columns ?? []).find(
      (column: any) => column.title === title
    )
    if (!createdColumn?.id) {
      return {
        ok: false,
        existing: false,
        error: `NocoDB created ${title}, but metadata did not expose its column id.`
      }
    }
    return { ok: true, id: createdColumn.id, existing: false }
  } catch (error: any) {
    return {
      ok: false,
      existing: false,
      error: error?.response?.data?.message ?? error?.response?.data?.msg ?? error.message
    }
  }
}

async function linkMarket(link: MarketLink, fieldId: string): Promise<{ ok: boolean; error?: string }> {
  const bodies = [
    [{ Id: link.marketRecordId }],
    { Id: link.marketRecordId },
    { data: [{ Id: link.marketRecordId }] }
  ]

  for (const body of bodies) {
    try {
      await nocoRequest(
        'post',
        `/api/v2/tables/${link.tableId}/links/${fieldId}/records/${link.recordId}`,
        body
      )
      return { ok: true }
    } catch (error: any) {
      const status = error?.response?.status
      const message =
        error?.response?.data?.message ?? error?.response?.data?.msg ?? error.message
      if (status !== 400 && status !== 422) {
        return { ok: false, error: message }
      }
    }
  }

  return { ok: false, error: 'NocoDB rejected all known link payload shapes.' }
}

async function buildPlans(marketRecordIds: Record<'ru' | 'en' | 'both', number>): Promise<{
  patches: MarketPatch[]
  links: MarketLink[]
  unknown: unknown[]
}> {
  const patches: MarketPatch[] = []
  const links: MarketLink[] = []
  const unknown: unknown[] = []

  for (const table of MARKET_SOURCE_TABLES) {
    const records = await fetchRecords(table.id)
    for (const record of records) {
      const sourceMarket = rawMarketValue(record, table.key)
      const normalized = normalizeMarket(sourceMarket)
      if (!normalized) {
        unknown.push({
          tableKey: table.key,
          recordId: record.Id,
          market: sourceMarket,
          label: recordLabel(record)
        })
        continue
      }

      if (typeof record.market !== 'object' && record.market !== normalized) {
        patches.push({
          tableKey: table.key,
          tableId: table.id,
          recordId: record.Id,
          before: record.market,
          after: normalized,
          label: recordLabel(record)
        })
      }

      const relationName = relationTitle(table.key)
      const marketRecordId = marketRecordIds[normalized]
      if (!existingLinkedMarketIds(record, relationName).has(marketRecordId)) {
        links.push({
          tableKey: table.key,
          tableId: table.id,
          relationName,
          recordId: record.Id,
          market: normalized,
          marketRecordId
        })
      }
    }
  }

  return { patches, links, unknown }
}

function makeReportDir(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.resolve(__dirname, '..', '..', 'logs', 'nocodb-sync-markets', timestamp)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeJson(dir: string, fileName: string, value: unknown): void {
  fs.writeFileSync(path.join(dir, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  assertConfig()
  const apply = process.argv.includes('--apply')
  const dir = makeReportDir()

  if (!apply) {
    const existingMarketTable = (await fetchTables()).find(
      table => String(table.title ?? table.table_name ?? '').toLowerCase() === 'market'
    )
    const marketRecordIds = existingMarketTable?.id
      ? await ensureMarketRows({
          key: 'market',
          id: existingMarketTable.id,
          title: existingMarketTable.title ?? 'market'
        })
      : { ru: -1, en: -1, both: -1 }
    const plans = await buildPlans(marketRecordIds)
    writeJson(dir, 'summary.json', {
      mode: 'dry-run',
      marketTableExists: Boolean(existingMarketTable),
      patches: plans.patches.length,
      links: plans.links.length,
      unknown: plans.unknown.length
    })
    writeJson(dir, 'patches.json', plans.patches)
    writeJson(dir, 'links.json', plans.links)
    writeJson(dir, 'unknown-market-values.json', plans.unknown)
    writeJson(dir, 'apply-result.json', { mode: 'dry-run', applied: false })
    console.log(`NocoDB market sync dry-run written to ${dir}`)
    return
  }

  const marketTable = await createMarketTable()
  const marketColumnResult = await ensureMarketColumnOnly(marketTable)
  const marketRecordIds = await ensureMarketRows(marketTable)
  const plans = await buildPlans(marketRecordIds)
  const relationFields: Record<string, unknown> = {}
  const linked = []
  const linkFailures = []
  const patched = []
  const patchFailures = []

  for (const patch of plans.patches) {
    try {
      await patchRecord(patch.tableId, patch.recordId, { market: patch.after })
      patched.push(patch)
    } catch (error: any) {
      patchFailures.push({
        patch,
        error: error?.response?.data?.message ?? error?.response?.data?.msg ?? error.message
      })
    }
    await wait(120)
  }

  for (const table of MARKET_SOURCE_TABLES) {
    relationFields[table.key] = await ensureMarketRelationField(table, marketTable)
    await wait(120)
  }

  for (const link of plans.links) {
    const field = relationFields[link.tableKey] as { ok?: boolean; id?: string; error?: string }
    if (!field?.ok || !field.id) {
      linkFailures.push({ link, error: field?.error ?? 'Market relation field unavailable.' })
      continue
    }

    const result = await linkMarket(link, field.id)
    if (result.ok) {
      linked.push(link)
    } else {
      linkFailures.push({ link, error: result.error })
    }
    await wait(120)
  }

  writeJson(dir, 'summary.json', {
    mode: 'apply',
    marketTable,
    patches: plans.patches.length,
    links: plans.links.length,
    unknown: plans.unknown.length
  })
  writeJson(dir, 'patches.json', plans.patches)
  writeJson(dir, 'links.json', plans.links)
  writeJson(dir, 'unknown-market-values.json', plans.unknown)
  writeJson(dir, 'apply-result.json', {
    mode: 'apply',
    marketTable,
    marketColumnResult,
    marketRecordIds,
    relationFields,
    patched: patched.length,
    patchFailures,
    linked: linked.length,
    linkFailures
  })

  console.log(`NocoDB market sync apply written to ${dir}`)

  if (patchFailures.length || linkFailures.length) {
    process.exitCode = 1
  }
}

main().catch(error => {
  const message = error?.response?.data ?? error?.message ?? error
  console.error(JSON.stringify(message, null, 2))
  process.exitCode = 1
})
