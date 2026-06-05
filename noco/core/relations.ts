const { describeDetailedError, describeError } = require('./errors.ts') as {
  describeDetailedError(error: any): Record<string, unknown>
  describeError(error: any): string
}

type TableConfig = {
  id: string
  title: string
}

type NocoClient = {
  fetchTableMeta(tableId: string): Promise<any>
  request<T>(method: 'get' | 'post' | 'patch' | 'delete', endpoint: string, body?: unknown): Promise<T>
}

type LinkedRecord = Record<string, unknown>

function noMigrationRefsEnabled(): boolean {
  return String(process.env.NOCO_NO_MIGRATION_REFS ?? '').trim().toLowerCase() === 'true'
}

function migrationRefValue<T>(value: T, context: string): T | undefined {
  if (!noMigrationRefsEnabled()) {
    return value
  }

  const hasValue = value !== null && value !== undefined && String(value).trim() !== ''
  if (hasValue && String(process.env.NOCO_NO_MIGRATION_REFS_VERBOSE ?? '').toLowerCase() === 'true') {
    console.warn(`NOCO_NO_MIGRATION_REFS ignored ${context}`)
  }
  return undefined
}

function assertMigrationRefsAllowed(context: string): void {
  if (noMigrationRefsEnabled()) {
    throw new Error(`NOCO_NO_MIGRATION_REFS blocked migration ref usage: ${context}`)
  }
}

function getLinkedRecords(value: unknown): LinkedRecord[] {
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is LinkedRecord => Boolean(item) && typeof item === 'object')
  }
  if (typeof value === 'object') {
    const maybeData = (value as Record<string, unknown>).data
    if (Array.isArray(maybeData)) {
      return maybeData.filter((item): item is LinkedRecord => Boolean(item) && typeof item === 'object')
    }
    return [value as LinkedRecord]
  }
  return []
}

function getLinkedRecord(value: unknown): LinkedRecord | null {
  return getLinkedRecords(value)[0] ?? null
}

function getLinkedRecordId(value: unknown): number | null {
  const record = getLinkedRecord(value)
  const id = Number(record?.Id ?? record?.id)
  return Number.isFinite(id) && id > 0 ? id : null
}

function recordDisplayName(record: Record<string, unknown> | null | undefined): string {
  if (!record) {
    return ''
  }
  const fields = [
    record.client_name,
    record.company_name,
    record.name,
    record.stack,
    record.stack_name,
    record.title,
    record.dolphin_profile_id,
    record.locale
  ]
  return String(fields.find(value => String(value ?? '').trim()) ?? '').trim()
}

function formatLinkedRecordLabel(record: Record<string, unknown> | null | undefined): string {
  if (!record) {
    return ''
  }
  const id = Number(record.Id ?? record.id)
  const name = recordDisplayName(record)
  if (Number.isFinite(id) && id > 0 && name) {
    return `${id} ${name}`
  }
  if (Number.isFinite(id) && id > 0) {
    return String(id)
  }
  return name
}

function formatLinkedRelationLabel(value: unknown): string {
  return getLinkedRecords(value)
    .map(formatLinkedRecordLabel)
    .filter(Boolean)
    .join(', ')
}

async function renameColumn(
  client: NocoClient,
  columnId: string,
  title: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await client.request('patch', `/api/v2/meta/columns/${columnId}`, {
      title,
      column_name: title
    })
    return { ok: true }
  } catch (error: any) {
    return { ok: false, error: describeError(error) }
  }
}

async function ensureRelationField(
  client: NocoClient,
  sourceTable: TableConfig,
  relatedTable: TableConfig,
  title: string,
  type = 'mm'
): Promise<{
  ok: boolean
  id?: string
  existing: boolean
  error?: string
  attemptErrors?: Array<Record<string, unknown>>
}> {
  const meta = await client.fetchTableMeta(sourceTable.id)
  const existing = (meta.columns ?? []).find((column: any) => column.title === title)
  if (existing?.id) {
    return { ok: true, id: existing.id, existing: true }
  }

  const existingByRelation = (meta.columns ?? [])
    .filter((column: any) => {
      const options = column.colOptions ?? {}
      return (
        !column.system &&
        (column.uidt === 'LinkToAnotherRecord' || column.uidt === 'Links') &&
        options.type === type &&
        options.fk_related_model_id === relatedTable.id
      )
    })
    .sort((a: any, b: any) => Number(a.order ?? 0) - Number(b.order ?? 0))[0]

  if (existingByRelation?.id) {
    const renameResult = await renameColumn(client, existingByRelation.id, title)
    return {
      ok: true,
      id: existingByRelation.id,
      existing: true,
      ...(renameResult.ok
        ? {}
        : { error: `Reused existing relation, but could not rename it: ${renameResult.error}` })
    }
  }

  const attempts = [
    {
      title,
      column_name: title,
      uidt: 'LinkToAnotherRecord',
      type,
      childId: sourceTable.id,
      parentId: relatedTable.id
    },
    {
      title,
      column_name: title,
      uidt: 'Links',
      type,
      childId: sourceTable.id,
      parentId: relatedTable.id
    }
  ]
  let lastError: any
  const attemptErrors: Array<Record<string, unknown>> = []

  for (const body of attempts) {
    try {
      await client.request('post', `/api/v2/meta/tables/${sourceTable.id}/columns`, body)
      const updatedMeta = await client.fetchTableMeta(sourceTable.id)
      const created = (updatedMeta.columns ?? []).find((column: any) => column.title === title)
      if (created?.id) {
        return { ok: true, id: created.id, existing: false }
      }
    } catch (error: any) {
      lastError = error
      attemptErrors.push({ body, error: describeDetailedError(error) })
      const status = error?.response?.status
      if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
        throw error
      }
    }
  }

  return {
    ok: false,
    existing: false,
    error: describeError(lastError),
    attemptErrors
  }
}

function uniqueRelatedIds(relatedIds: number[]): number[] {
  return [...new Set(relatedIds)].filter(Boolean)
}

function buildLinkPayloads(relatedIds: number[]): unknown[] {
  const ids = uniqueRelatedIds(relatedIds)
  return [
    ids.map(Id => ({ Id })),
    { data: ids.map(Id => ({ Id })) }
  ]
}

async function linkRecords(
  client: NocoClient,
  sourceTable: TableConfig,
  fieldId: string,
  sourceRecordId: number,
  relatedIds: number[]
): Promise<{ ok: boolean; linked?: number; error?: string }> {
  const ids = uniqueRelatedIds(relatedIds)
  if (!ids.length) {
    return { ok: true, linked: 0 }
  }

  for (const body of buildLinkPayloads(ids)) {
    try {
      await client.request(
        'post',
        `/api/v2/tables/${sourceTable.id}/links/${fieldId}/records/${sourceRecordId}`,
        body
      )
      return { ok: true, linked: ids.length }
    } catch (error: any) {
      const status = error?.response?.status
      if (status !== 400 && status !== 422) {
        return { ok: false, error: describeError(error) }
      }
    }
  }

  return { ok: false, error: 'NocoDB rejected all known link payload shapes.' }
}

module.exports = {
  buildLinkPayloads,
  ensureRelationField,
  assertMigrationRefsAllowed,
  formatLinkedRecordLabel,
  formatLinkedRelationLabel,
  getLinkedRecord,
  getLinkedRecordId,
  getLinkedRecords,
  recordDisplayName,
  linkRecords,
  migrationRefValue,
  renameColumn,
  noMigrationRefsEnabled,
  uniqueRelatedIds
}
