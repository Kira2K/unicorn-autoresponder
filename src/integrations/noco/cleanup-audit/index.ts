const assert = require('node:assert/strict')

const { createNocoClient } = require('../core/client.ts') as {
  createNocoClient(options?: any): any
}
const { describeError } = require('../core/errors.ts') as {
  describeError(error: any): string
}
const { parseJobArgs } = require('../core/job.ts') as {
  parseJobArgs(args?: string[]): { apply: boolean; test: boolean; mode: 'dry-run' | 'apply' | 'test' }
}
const { createReportDir, writeJson, writeText } = require('../core/reports.ts') as {
  createReportDir(jobName: string): string
  writeJson(dir: string, fileName: string, data: unknown): void
  writeText(dir: string, fileName: string, content: string): void
}

type NocoRecord = Record<string, unknown> & { Id: number }
type ColumnMeta = {
  id?: string
  title: string
  uidt?: string
  system?: boolean
  pk?: boolean
  pv?: boolean
  colOptions?: Record<string, unknown>
}
type TableMeta = {
  id: string
  title: string
  columns: ColumnMeta[]
}
type ColumnAudit = {
  tableId: string
  tableTitle: string
  columnId?: string
  title: string
  uidt?: string
  system: boolean
  nonEmpty: number
  totalRecords: number
  sampleValues: string[]
  category: 'drop_candidate' | 'archive_candidate' | 'review_candidate' | 'keep'
  reasons: string[]
}

const JOB_NAME = 'nocodb-cleanup-audit'
const APPROVED_DROP_COLUMNS = new Set([
  'clients.Students1',
  'hh-autoresponses.имя',
  'hh-autoresponses.Id_общего_чата',
  'hh-autoresponses.Dolphin_Profile_Ru_Id',
  'hh-autoresponses.Dolphin_Profile_En_Id',
  'hh-autoresponses.rel_hhAutoresponses_dolphin_profile_ru',
  'hh-autoresponses.rel_hhAutoresponses_dolphin_profile_en',
  'hh-autoresponses.rel_hhAutoresponses_hh_account_ru',
  'hh-autoresponses.rel_hhAutoresponses_hh_account_en',
  'hh-autoresponses.stack'
])
const APPROVED_NON_EMPTY_DROP_COLUMNS = new Set(
  [...APPROVED_DROP_COLUMNS].filter(key => key.startsWith('hh-autoresponses.'))
)
const TODO_TO_FILL_COLUMNS = new Set([
  'clients.actual_country',
  'contracts_payments.prepayment_parts_count',
  'contracts_payments.prepayment_status',
  'contracts_payments.prepayment_destination',
  'contracts_payments.contract_legal_entity',
  'contracts_payments.contract_type',
  'contracts_payments.signed_contract_link',
  'contracts_payments.program_for_contract',
  'contracts_payments.student_level_from_hard_mentor',
  'platform_accounts.birth_date',
  'mentors.Payment country'
])
const PROVENANCE_COLUMNS_TO_KEEP = new Set([
  'hh_conversion_snapshots.source_row'
])

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false
  }
  if (Array.isArray(value)) {
    return value.length > 0
  }
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length > 0
  }
  return String(value).trim() !== ''
}

function normalizeColumnTitle(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, '_')
}

function sampleValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'object') {
    return JSON.stringify(value).slice(0, 160)
  }
  return String(value).slice(0, 160)
}

function isRelationColumn(column: ColumnMeta): boolean {
  return ['LinkToAnotherRecord', 'Links', 'ForeignKey'].includes(String(column.uidt ?? ''))
}

function looksLikeGeneratedDuplicate(title: string): boolean {
  return /1$/.test(title) || title === 'Students1'
}

function looksLikeMigrationTrace(title: string): boolean {
  return (
    title === 'source_column' ||
    title === 'source_row' ||
    title === 'relation_notes' ||
    title === 'relation_status' ||
    title === 'relation_confidence' ||
    title === 'client_quality_notes' ||
    title === 'client_quality_status' ||
    title === 'contract_notes'
  )
}

function columnKey(tableTitle: string, columnTitle: string): string {
  return `${tableTitle}.${columnTitle}`
}

function classifyColumn(input: {
  column: ColumnMeta
  nonEmpty: number
  duplicateTitleCount: number
  tableTitle: string
}): { category: ColumnAudit['category']; reasons: string[] } {
  const title = input.column.title
  const normalizedTitle = normalizeColumnTitle(title)
  const key = columnKey(input.tableTitle, title)
  const reasons: string[] = []

  if (input.column.system || input.column.pk || normalizedTitle === 'id') {
    return { category: 'keep', reasons: ['system_or_primary_column'] }
  }

  if (TODO_TO_FILL_COLUMNS.has(key)) {
    return { category: 'keep', reasons: ['todo_to_fill_not_cleanup_bug'] }
  }

  if (PROVENANCE_COLUMNS_TO_KEEP.has(key)) {
    return { category: 'keep', reasons: ['snapshot_provenance_column'] }
  }

  if (looksLikeMigrationTrace(title)) {
    return { category: 'archive_candidate', reasons: ['migration_trace_or_quality_field'] }
  }

  if (input.duplicateTitleCount > 1) {
    reasons.push('duplicate_column_title')
  }

  if (isRelationColumn(input.column)) {
    if (input.nonEmpty === 0 && looksLikeGeneratedDuplicate(title)) {
      return {
        category: 'review_candidate',
        reasons: [...reasons, 'empty_relation_column_with_generated_duplicate_name']
      }
    }

    return { category: 'keep', reasons: [...reasons, 'relation_column'] }
  }

  if (input.nonEmpty === 0 && looksLikeGeneratedDuplicate(title)) {
    return { category: 'drop_candidate', reasons: [...reasons, 'empty_generated_duplicate_column'] }
  }

  if (input.nonEmpty === 0) {
    return { category: 'review_candidate', reasons: [...reasons, 'empty_non_relation_column'] }
  }

  if (/^col_[a-z]+$/i.test(title)) {
    return { category: 'review_candidate', reasons: [...reasons, 'raw_generated_column_name'] }
  }

  return { category: 'keep', reasons: reasons.length ? reasons : ['active_or_canonical_column'] }
}

function auditTable(table: TableMeta, records: NocoRecord[]): ColumnAudit[] {
  const titleCounts = new Map<string, number>()
  for (const column of table.columns) {
    const key = normalizeColumnTitle(column.title)
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1)
  }

  return table.columns.map(column => {
    const values = records.map(record => record[column.title])
    const nonEmptyValues = values.filter(hasValue)
    const classification = classifyColumn({
      column,
      nonEmpty: nonEmptyValues.length,
      duplicateTitleCount: titleCounts.get(normalizeColumnTitle(column.title)) ?? 0,
      tableTitle: table.title
    })

    return {
      tableId: table.id,
      tableTitle: table.title,
      columnId: column.id,
      title: column.title,
      uidt: column.uidt,
      system: Boolean(column.system),
      nonEmpty: nonEmptyValues.length,
      totalRecords: records.length,
      sampleValues: [...new Set(nonEmptyValues.map(sampleValue).filter(Boolean))].slice(0, 5),
      category: classification.category,
      reasons: classification.reasons
    }
  })
}

function summarize(audit: ColumnAudit[]): Record<string, unknown> {
  const byCategory: Record<string, number> = {}
  const byTable: Record<string, Record<string, number>> = {}

  for (const column of audit) {
    byCategory[column.category] = (byCategory[column.category] ?? 0) + 1
    byTable[column.tableTitle] = byTable[column.tableTitle] ?? {}
    byTable[column.tableTitle][column.category] =
      (byTable[column.tableTitle][column.category] ?? 0) + 1
  }

  return {
    checkedAt: new Date().toISOString(),
    totalColumns: audit.length,
    byCategory,
    byTable
  }
}

function renderManualReview(audit: ColumnAudit[]): string {
  const lines = [
    '# Noco Cleanup Audit',
    '',
    'This is a read-only report. Do not delete columns from this report without a separate approval step.',
    '',
    '## Drop Candidates',
    ''
  ]

  for (const item of audit.filter(column => column.category === 'drop_candidate')) {
    lines.push(
      `- ${item.tableTitle}.${item.title}: ${item.reasons.join(', ')}; nonEmpty=${item.nonEmpty}/${item.totalRecords}`
    )
  }

  lines.push('', '## Archive Candidates', '')
  for (const item of audit.filter(column => column.category === 'archive_candidate')) {
    lines.push(
      `- ${item.tableTitle}.${item.title}: ${item.reasons.join(', ')}; nonEmpty=${item.nonEmpty}/${item.totalRecords}`
    )
  }

  lines.push('', '## Review Candidates', '')
  for (const item of audit.filter(column => column.category === 'review_candidate')) {
    lines.push(
      `- ${item.tableTitle}.${item.title}: ${item.reasons.join(', ')}; nonEmpty=${item.nonEmpty}/${item.totalRecords}`
    )
  }

  return `${lines.join('\n')}\n`
}

async function loadAudit(client = createNocoClient()): Promise<{
  schemaSnapshot: Array<Record<string, unknown>>
  audit: ColumnAudit[]
}> {
  const tables = (await client.request(
    'get',
    `/api/v2/meta/bases/${client.config.baseId}/tables`
  ) as { list?: Array<{ id: string; title?: string; table_name?: string }> }).list ?? []

  const schemaSnapshot = []
  const audit: ColumnAudit[] = []

  for (const table of tables) {
    const meta = await client.fetchTableMeta(table.id)
    const records = await client.fetchRecords(table.id, 100)
    const tableMeta: TableMeta = {
      id: table.id,
      title: String(table.title ?? table.table_name ?? table.id),
      columns: meta.columns ?? []
    }

    schemaSnapshot.push({
      id: tableMeta.id,
      title: tableMeta.title,
      records: records.length,
      columns: tableMeta.columns.map(column => ({
        id: column.id,
        title: column.title,
        uidt: column.uidt,
        system: Boolean(column.system)
      }))
    })

    audit.push(...auditTable(tableMeta, records))
  }

  return { schemaSnapshot, audit }
}

function writeReports(dir: string, report: { schemaSnapshot: unknown[]; audit: ColumnAudit[] }): void {
  writeJson(dir, 'summary.json', summarize(report.audit))
  writeJson(dir, 'schema-snapshot.json', report.schemaSnapshot)
  writeJson(dir, 'column-audit.json', report.audit)
  writeJson(dir, 'drop-candidates.json', report.audit.filter(column => column.category === 'drop_candidate'))
  writeJson(dir, 'archive-candidates.json', report.audit.filter(column => column.category === 'archive_candidate'))
  writeJson(dir, 'review-candidates.json', report.audit.filter(column => column.category === 'review_candidate'))
  writeJson(dir, 'keep-candidates.json', report.audit.filter(column => column.category === 'keep'))
  writeText(dir, 'manual-review.md', renderManualReview(report.audit))
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

async function applyApprovedDrops(
  audit: ColumnAudit[],
  client = createNocoClient()
): Promise<Record<string, unknown>> {
  const approvedCandidates = audit.filter(column =>
    APPROVED_DROP_COLUMNS.has(`${column.tableTitle}.${column.title}`)
  )
  const genericDropCandidates = audit.filter(column => column.category === 'drop_candidate')
  const dropCandidates = [
    ...new Map(
      [...approvedCandidates, ...genericDropCandidates].map(column => [
        `${column.tableTitle}.${column.title}`,
        column
      ])
    ).values()
  ]
  const results = []

  for (const column of dropCandidates) {
    const key = `${column.tableTitle}.${column.title}`
    const approved = APPROVED_DROP_COLUMNS.has(key)

    if (!approved) {
      results.push({
        action: 'delete_column',
        ok: false,
        skipped: true,
        reason: 'drop_candidate_not_in_approved_scope',
        column
      })
      continue
    }

    if (column.nonEmpty !== 0 && !APPROVED_NON_EMPTY_DROP_COLUMNS.has(key)) {
      results.push({
        action: 'delete_column',
        ok: false,
        skipped: true,
        reason: 'approved_column_is_not_empty',
        column
      })
      continue
    }

    if (!column.columnId) {
      results.push({
        action: 'delete_column',
        ok: false,
        skipped: true,
        reason: 'missing_column_id',
        column
      })
      continue
    }

    const deleteResult = await deleteColumn(client, column.columnId)
    results.push({
      action: 'delete_column',
      ok: deleteResult.ok,
      key,
      column,
      result: deleteResult
    })
    await client.wait(120)
  }

  return {
    approvedScope: [...APPROVED_DROP_COLUMNS],
    attempted: results.length,
    deleted: results.filter(item => item.ok).length,
    failed: results.filter(item => item.ok === false && !item.skipped).length,
    skipped: results.filter(item => item.skipped).length,
    results
  }
}

function runTests(): void {
  const table = {
    id: 'tbl',
    title: 'clients',
    columns: [
      { title: 'Id', uidt: 'ID', system: true },
      { title: 'Students1', uidt: 'SingleLineText' },
      { title: 'source_column', uidt: 'SingleLineText' },
      { title: 'actual_country', uidt: 'SingleLineText' },
      { title: 'market', uidt: 'LinkToAnotherRecord' },
      { title: 'col_AA', uidt: 'SingleLineText' },
      { title: 'client_name', uidt: 'SingleLineText' }
    ]
  }
  const audit = auditTable(table, [
    { Id: 1, client_name: 'Кира', col_AA: '' },
    { Id: 2, client_name: 'Иван', col_AA: 'raw' }
  ])
  const byTitle = new Map(audit.map(item => [item.title, item]))

  assert.equal(byTitle.get('Id')?.category, 'keep')
  assert.equal(byTitle.get('Students1')?.category, 'drop_candidate')
  assert.equal(byTitle.get('source_column')?.category, 'archive_candidate')
  assert.equal(byTitle.get('actual_country')?.category, 'keep')
  assert.deepEqual(byTitle.get('actual_country')?.reasons, ['todo_to_fill_not_cleanup_bug'])
  assert.equal(byTitle.get('market')?.category, 'keep')
  assert.equal(byTitle.get('col_AA')?.category, 'review_candidate')
  assert.equal(byTitle.get('client_name')?.category, 'keep')
}

async function main(): Promise<void> {
  const args = parseJobArgs()

  if (args.test) {
    runTests()
    console.log('noco:cleanup-audit tests passed')
    return
  }

  const dir = createReportDir(JOB_NAME)
  const client = createNocoClient()
  const report = await loadAudit(client)
  writeReports(dir, report)

  if (args.apply) {
    const applyResult = await applyApprovedDrops(report.audit, client)
    writeJson(dir, 'apply-result.json', applyResult)

    const postApply = await loadAudit(client)
    writeJson(dir, 'post-apply-summary.json', summarize(postApply.audit))
    writeJson(
      dir,
      'post-apply-drop-candidates.json',
      postApply.audit.filter(column => column.category === 'drop_candidate')
    )

    console.log(`NocoDB cleanup apply written to ${dir}`)
    console.log(JSON.stringify({ before: summarize(report.audit), applyResult, after: summarize(postApply.audit) }, null, 2))
    if (applyResult.failed) {
      process.exitCode = 1
    }
    return
  }

  writeJson(dir, 'apply-result.json', { mode: 'dry-run', applied: false })
  console.log(`NocoDB cleanup audit written to ${dir}`)
  console.log(JSON.stringify(summarize(report.audit), null, 2))
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(describeError(error))
    process.exitCode = 1
  })
}

module.exports = {
  auditTable,
  applyApprovedDrops,
  classifyColumn,
  deleteColumn,
  hasValue,
  loadAudit,
  renderManualReview,
  runTests,
  summarize
}
