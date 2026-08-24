import { LINKEDIN_PROFILE_JOB_COLUMNS } from './columns.ts'

export const TABLE_TITLE = 'linkedin_profile_jobs'

function list(value: any): any[] {
  return Array.isArray(value) ? value : value?.list ?? value?.data ?? []
}

export function findTable(value: any) {
  return list(value).find(table =>
    String(table.title ?? table.table_name ?? '').trim().toLowerCase() === TABLE_TITLE)
}

export function missingColumns(meta: any) {
  const existing = new Set(list(meta?.columns).map(column =>
    String(column.title ?? column.column_name ?? '').trim()))
  return LINKEDIN_PROFILE_JOB_COLUMNS.filter(column => !existing.has(column.title))
    .map(column => column.title)
}

export async function ensureLinkedInProfileJobsTable(client: any, baseId: string, apply: boolean) {
  const endpoint = `/api/v2/meta/bases/${baseId}/tables`
  let table = findTable(await client.request('get', endpoint))
  const existed = Boolean(table?.id)
  if (!table && apply) {
    await client.request('post', endpoint, {
      title: TABLE_TITLE, table_name: TABLE_TITLE, columns: LINKEDIN_PROFILE_JOB_COLUMNS
    })
    table = findTable(await client.request('get', endpoint))
  }
  if (!table?.id) return {
    mode: apply ? 'apply' : 'dry-run', exists: false, created: false,
    missing: LINKEDIN_PROFILE_JOB_COLUMNS.map(column => column.title)
  }
  const missing = missingColumns(await client.fetchTableMeta(table.id))
  if (apply) for (const title of missing) {
    await client.request('post', `/api/v2/meta/tables/${table.id}/columns`,
      LINKEDIN_PROFILE_JOB_COLUMNS.find(column => column.title === title))
  }
  return { mode: apply ? 'apply' : 'dry-run', exists: true, created: apply && !existed,
    tableId: table.id, missing: apply ? [] : missing }
}
