import { CONNECTION_SEARCH_CATALOG } from '../../../features/linkedin-automation/connection-inviter/catalog.ts'
import { CONNECTION_CATALOG_COLUMNS, CONNECTION_HISTORY_COLUMNS, CONNECTION_RUN_COLUMNS } from './columns.ts'
import { missingUniqueColumns, requiredUniqueColumns } from './constraints.ts'

export const CONNECTION_TABLES = {
  catalog: { title: 'linkedin_connection_search_catalog', columns: CONNECTION_CATALOG_COLUMNS },
  runs: { title: 'linkedin_connection_runs', columns: CONNECTION_RUN_COLUMNS },
  history: { title: 'linkedin_connection_history', columns: CONNECTION_HISTORY_COLUMNS }
} as const

const list = (value: any): any[] => Array.isArray(value) ? value : value?.list ?? value?.data ?? []

export function findConnectionTable(value: any, title: string) {
  const normalized = title.trim().toLowerCase()
  return list(value).find(table =>
    String(table.title ?? table.table_name ?? '').trim().toLowerCase() === normalized)
}

export function missingConnectionColumns(meta: any, columns: ReadonlyArray<{ title: string }>) {
  const existing = new Set(list(meta?.columns).map(column =>
    String(column.title ?? column.column_name ?? '').trim()))
  return columns.filter(column => !existing.has(column.title)).map(column => column.title)
}

async function ensureTable(client: any, baseId: string, definition: any, apply: boolean,
  initialTables: any[]) {
  const endpoint = `/api/v2/meta/bases/${baseId}/tables`
  let table = findConnectionTable(initialTables, definition.title)
  const existed = Boolean(table?.id)
  if (!table && apply) {
    await client.request('post', endpoint, { title: definition.title, table_name: definition.title,
      columns: definition.columns })
    table = findConnectionTable(await client.request('get', endpoint), definition.title)
  }
  if (!table?.id) return { title: definition.title, exists: false, created: false,
    missing: definition.columns.map((column: any) => column.title),
    missingUnique: requiredUniqueColumns(definition.columns) }
  const before = await client.fetchTableMeta(table.id)
  const missing = missingConnectionColumns(before, definition.columns)
  if (apply) for (const title of missing) {
    await client.request('post', `/api/v2/meta/tables/${table.id}/columns`,
      definition.columns.find((column: any) => column.title === title))
  }
  const after = apply ? await client.fetchTableMeta(table.id) : before
  const missingUnique = missingUniqueColumns(after, definition.columns)
  if (apply && missingUnique.length) throw Object.assign(
    new Error(`${definition.title} lacks unique constraints: ${missingUnique.join(', ')}`),
    { code: 'connection_inviter_unique_constraints_missing' })
  return { title: definition.title, exists: true, created: apply && !existed,
    tableId: String(table.id), missing: apply ? [] : missing, missingUnique }
}

function catalogRow(template: typeof CONNECTION_SEARCH_CATALOG[number]) {
  return { source_key: template.sourceKey, audience: template.audience, city: template.city,
    keyword_template: template.keywordTemplate, priority: template.priority, enabled: template.enabled }
}

async function seedCatalog(client: any, tableId: string, apply: boolean) {
  const rows = await client.fetchRecords(tableId, 1000)
  const existing = new Set(rows.map((row: any) => String(row.source_key ?? '').trim()))
  const missing = CONNECTION_SEARCH_CATALOG.filter(template => !existing.has(template.sourceKey))
  if (apply) for (let offset = 0; offset < missing.length; offset += 100) {
    await client.request('post', `/api/v2/tables/${tableId}/records`,
      missing.slice(offset, offset + 100).map(catalogRow))
  }
  const readBackCount = apply ? (await client.fetchRecords(tableId, 1000)).filter((row: any) =>
    CONNECTION_SEARCH_CATALOG.some(template => template.sourceKey === row.source_key)).length : rows.length
  return { expected: CONNECTION_SEARCH_CATALOG.length, existing: rows.length,
    missing: apply ? 0 : missing.length, created: apply ? missing.length : 0, readBackCount }
}

export async function ensureConnectionInviterSchema(client: any, baseId: string, apply: boolean) {
  const endpoint = `/api/v2/meta/bases/${baseId}/tables`
  const initialTables = list(await client.request('get', endpoint))
  const tables: Record<string, any> = {}
  for (const [key, definition] of Object.entries(CONNECTION_TABLES)) {
    tables[key] = await ensureTable(client, baseId, definition, apply, initialTables)
  }
  const catalog = tables.catalog.tableId
    ? await seedCatalog(client, tables.catalog.tableId, apply)
    : { expected: CONNECTION_SEARCH_CATALOG.length, existing: 0,
      missing: CONNECTION_SEARCH_CATALOG.length, created: 0, readBackCount: 0 }
  return { mode: apply ? 'apply' : 'dry-run', tables, catalog }
}
