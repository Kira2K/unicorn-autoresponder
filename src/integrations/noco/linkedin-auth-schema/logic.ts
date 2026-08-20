const LINKEDIN_AUTH_COLUMNS = [
  { title: 'unipile_account_id', uidt: 'SingleLineText' },
  { title: 'unipile_account_status', uidt: 'SingleLineText' },
  { title: 'linkedin_verified_provider_id', uidt: 'SingleLineText' },
  { title: 'linkedin_verified_profile_url', uidt: 'URL' },
  { title: 'linkedin_verified_profile_name', uidt: 'SingleLineText' },
  { title: 'linkedin_last_verified_at', uidt: 'DateTime' },
  { title: 'linkedin_auth_error_code', uidt: 'SingleLineText' },
  { title: 'linkedin_auth_updated_at', uidt: 'DateTime' }
] as const

type SchemaClient = {
  fetchTableMeta(tableId: string): Promise<any>
  request<T>(method: 'post', endpoint: string, body: unknown): Promise<T>
}

function columnTitle(column: any): string {
  return String(column?.title ?? column?.column_name ?? '').trim()
}

function inspectLinkedInAuthSchema(meta: any) {
  const existing = new Set((meta?.columns ?? []).map(columnTitle))
  const columns = LINKEDIN_AUTH_COLUMNS.map(column => ({
    ...column,
    exists: existing.has(column.title)
  }))

  return {
    ok: columns.every(column => column.exists),
    columns,
    missing: columns.filter(column => !column.exists).map(column => column.title)
  }
}

async function ensureLinkedInAuthSchema(
  client: SchemaClient,
  tableId: string,
  apply: boolean
) {
  const before = inspectLinkedInAuthSchema(await client.fetchTableMeta(tableId))
  const created: string[] = []

  if (apply) {
    for (const column of before.columns.filter(item => !item.exists)) {
      await client.request('post', `/api/v2/meta/tables/${tableId}/columns`, {
        title: column.title,
        column_name: column.title,
        uidt: column.uidt
      })
      created.push(column.title)
    }
  }

  const after = apply
    ? inspectLinkedInAuthSchema(await client.fetchTableMeta(tableId))
    : before

  if (apply && !after.ok) {
    throw new Error(
      `NocoDB LinkedIn auth schema is incomplete after apply: ${after.missing.join(', ')}`
    )
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    created,
    missingBefore: before.missing,
    missingAfter: after.missing,
    ok: after.ok
  }
}

module.exports = {
  LINKEDIN_AUTH_COLUMNS,
  ensureLinkedInAuthSchema,
  inspectLinkedInAuthSchema
}
