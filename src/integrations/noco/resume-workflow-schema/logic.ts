const RESUME_CLIENT_COLUMNS = [
  { title: 'education_entries', uidt: 'LongText' },
  { title: 'real_location', uidt: 'SingleLineText' },
  { title: 'desired_location', uidt: 'SingleLineText' }
] as const

const RESUME_CV_PROCESSING_COLUMNS = [
  { title: 'last_rejection_comment', uidt: 'LongText' },
  { title: 'rejection_history', uidt: 'LongText' }
] as const

const RESUME_PLATFORM_ROWS = [
  { label: 'github', name: 'github' }
] as const

type SchemaClient = {
  fetchTableMeta(tableId: string): Promise<any>
  fetchRecords(tableId: string, limit?: number, options?: Record<string, unknown>): Promise<any[]>
  createRecord(tableId: string, record: Record<string, unknown>): Promise<unknown>
  request<T>(method: 'post', endpoint: string, body: unknown): Promise<T>
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeKey(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, '_').toLowerCase()
}

function columnTitle(column: any): string {
  return normalizeText(column?.title ?? column?.column_name)
}

function inspectColumns(meta: any, expectedColumns: ReadonlyArray<{ title: string; uidt: string }>) {
  const existing = new Set((meta?.columns ?? []).map(columnTitle))
  const columns = expectedColumns.map(column => ({
    ...column,
    exists: existing.has(column.title)
  }))
  return {
    ok: columns.every(column => column.exists),
    columns,
    missing: columns.filter(column => !column.exists).map(column => column.title)
  }
}

function platformLabel(record: any): string {
  return normalizeKey(record?.label ?? record?.platform ?? record?.name)
}

function inspectPlatforms(records: any[]) {
  const existing = new Set(records.map(platformLabel))
  const rows = RESUME_PLATFORM_ROWS.map(row => ({
    ...row,
    exists: existing.has(normalizeKey(row.label))
  }))
  return {
    ok: rows.every(row => row.exists),
    rows,
    missing: rows.filter(row => !row.exists).map(row => row.label)
  }
}

async function createMissingColumns(
  client: SchemaClient,
  tableId: string,
  columns: ReadonlyArray<{ title: string; uidt: string; exists: boolean }>
): Promise<string[]> {
  const created: string[] = []
  for (const column of columns.filter(item => !item.exists)) {
    await client.request('post', `/api/v2/meta/tables/${tableId}/columns`, {
      title: column.title,
      column_name: column.title,
      uidt: column.uidt
    })
    created.push(column.title)
  }
  return created
}

async function ensureResumeWorkflowSchema(
  client: SchemaClient,
  tableIds: { clients: string; cvProcessing: string; platforms: string },
  apply: boolean
) {
  const beforeClients = inspectColumns(await client.fetchTableMeta(tableIds.clients), RESUME_CLIENT_COLUMNS)
  const beforeCvProcessing = inspectColumns(await client.fetchTableMeta(tableIds.cvProcessing), RESUME_CV_PROCESSING_COLUMNS)
  const beforePlatforms = inspectPlatforms(await client.fetchRecords(tableIds.platforms, 1000))
  const created = {
    clients: [] as string[],
    cvProcessing: [] as string[],
    platforms: [] as string[]
  }

  if (apply) {
    created.clients = await createMissingColumns(client, tableIds.clients, beforeClients.columns)
    created.cvProcessing = await createMissingColumns(client, tableIds.cvProcessing, beforeCvProcessing.columns)
    for (const row of beforePlatforms.rows.filter(item => !item.exists)) {
      await client.createRecord(tableIds.platforms, { label: row.label, name: row.name })
      created.platforms.push(row.label)
    }
  }

  const afterClients = apply
    ? inspectColumns(await client.fetchTableMeta(tableIds.clients), RESUME_CLIENT_COLUMNS)
    : beforeClients
  const afterCvProcessing = apply
    ? inspectColumns(await client.fetchTableMeta(tableIds.cvProcessing), RESUME_CV_PROCESSING_COLUMNS)
    : beforeCvProcessing
  const afterPlatforms = apply
    ? inspectPlatforms(await client.fetchRecords(tableIds.platforms, 1000))
    : beforePlatforms

  const missingAfter = [
    ...afterClients.missing.map(field => `clients.${field}`),
    ...afterCvProcessing.missing.map(field => `CV processing.${field}`),
    ...afterPlatforms.missing.map(field => `platforms:${field}`)
  ]
  if (apply && missingAfter.length) {
    throw new Error(`NocoDB resume workflow schema is incomplete after apply: ${missingAfter.join(', ')}`)
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    created,
    missingBefore: {
      clients: beforeClients.missing,
      cvProcessing: beforeCvProcessing.missing,
      platforms: beforePlatforms.missing
    },
    missingAfter: {
      clients: afterClients.missing,
      cvProcessing: afterCvProcessing.missing,
      platforms: afterPlatforms.missing
    },
    ok: !missingAfter.length
  }
}

module.exports = {
  RESUME_CLIENT_COLUMNS,
  RESUME_CV_PROCESSING_COLUMNS,
  RESUME_PLATFORM_ROWS,
  ensureResumeWorkflowSchema,
  inspectColumns,
  inspectPlatforms
}
