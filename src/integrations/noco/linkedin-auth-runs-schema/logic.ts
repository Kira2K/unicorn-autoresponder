const { LINKEDIN_AUTH_RUN_COLUMNS } = require('./columns.ts') as {
  LINKEDIN_AUTH_RUN_COLUMNS: ReadonlyArray<Record<string, unknown> & { title: string }>
}

const TABLE_TITLE = 'linkedin_auth_runs'

function tableList(value: any): any[] {
  return Array.isArray(value) ? value : value?.list ?? value?.data ?? []
}

function findTable(value: any) {
  return tableList(value).find(table =>
    String(table.title ?? table.table_name ?? '').trim().toLowerCase() === TABLE_TITLE
  )
}

function missingColumns(meta: any): string[] {
  const existing = new Set((meta?.columns ?? []).map((column: any) =>
    String(column.title ?? column.column_name ?? '').trim()
  ))
  return LINKEDIN_AUTH_RUN_COLUMNS.filter(column => !existing.has(column.title))
    .map(column => column.title)
}

async function ensureLinkedInAuthRunsTable(client: any, baseId: string, apply: boolean) {
  const endpoint = `/api/v2/meta/bases/${baseId}/tables`
  let table = findTable(await client.request('get', endpoint))
  const existed = Boolean(table?.id)
  if (!table && apply) {
    await client.request('post', endpoint, {
      title: TABLE_TITLE, table_name: TABLE_TITLE, columns: LINKEDIN_AUTH_RUN_COLUMNS
    })
    table = findTable(await client.request('get', endpoint))
  }
  if (!table?.id) return {
    mode: apply ? 'apply' : 'dry-run', exists: false, created: false,
    missing: LINKEDIN_AUTH_RUN_COLUMNS.map(column => column.title)
  }
  const missing = missingColumns(await client.fetchTableMeta(table.id))
  if (apply) {
    for (const title of missing) {
      const column = LINKEDIN_AUTH_RUN_COLUMNS.find(item => item.title === title)!
      await client.request('post', `/api/v2/meta/tables/${table.id}/columns`, column)
    }
  }
  return {
    mode: apply ? 'apply' : 'dry-run', exists: true, created: apply && !existed,
    tableId: table.id, missing: apply ? [] : missing
  }
}

module.exports = { TABLE_TITLE, ensureLinkedInAuthRunsTable, findTable, missingColumns }
