const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createNocoClient } = require('../core/client.ts') as {
  createNocoClient(options?: any): any
}
const { describeError } = require('../core/errors.ts') as {
  describeError(error: any): string
}
const { parseJobArgs } = require('../core/job.ts') as {
  parseJobArgs(args?: string[]): { apply: boolean; dryRun: boolean; test: boolean; mode: string }
}
const { createReportDir, writeJson, writeText } = require('../core/reports.ts') as {
  createReportDir(jobName: string): string
  writeJson(dir: string, fileName: string, data: unknown): void
  writeText(dir: string, fileName: string, content: string): void
}
const { TABLES } = require('../core/schema.ts') as {
  TABLES: Record<string, { key: string; id: string; title: string }>
}

type RefCategory = 'own_row_ref' | 'cross_table_ref' | 'archive_ref'
type RefDisposition = 'drop_later_candidate' | 'retired_dropped' | 'archive_only_keep'

type RefCandidate = {
  tableKey: string
  tableId: string
  tableTitle: string
  columnTitle: string
  category: RefCategory
  disposition: RefDisposition
  rationale: string
}

type ExpectedRelation = {
  key: string
  tableKey: string
  tableId: string
  tableTitle: string
  title: string
  relatedTableKey?: string
  relatedTableId?: string
  acceptableUidts: string[]
  rationale: string
}

const JOB_NAME = 'nocodb-ref-drop-readiness'
const CODE_SCAN_DIRS = ['noco']
const CODE_SCAN_EXTENSIONS = new Set(['.ts', '.js'])
const CODE_SCAN_EXCLUDED_DIRS = new Set([
  'drop-phase1a-ref-columns',
  'drop-final-ref-columns',
  'drop-phase2-ref-columns',
  'ref-drop-readiness'
])
const ARCHIVED_JOB_DIRS = new Set([
  'client-stability',
  'normalize-ids',
  'repair-contracts-payments',
  'sync-client-personal-telegram',
  'workbook-merge'
])
const RETIRED_ARCHIVED_JOB_DIRS = new Set(ARCHIVED_JOB_DIRS)

function isDisplayOrProvenanceUsage(match: { file: string; text: string }): boolean {
  const text = match.text
  if (
    /^(clientRef|companyRef|restrictionRef|resumeSheetRef|primaryStackRef):/.test(text) ||
    /^(childRef|parentRef|label|notes|tag|candidates):/.test(text)
  ) {
    return true
  }
  if (
    /^client_ref:/.test(text) ||
    /^company_ref:/.test(text) ||
    /^dolphin_profile_ref:/.test(text) ||
    /const clientRef = String\(client\.client_ref/.test(text) ||
    /migration client_ref fallback is disabled/.test(text)
  ) {
    return true
  }
  if (/(writeJson|writeText|renderManualReview|safeNocoProfile|safeBindings|manual-review)/.test(text)) {
    return true
  }
  if (/String\(.*\?\?.*Id\)/.test(text) || /clientName|rawClientName|companyName/.test(text)) {
    return true
  }
  if (/^\{? ?[a-zA-Z_]+: ['"][^'"]+['"],?$/.test(text)) {
    return true
  }
  return false
}

const REF_CANDIDATES: RefCandidate[] = [
  ref('stacks', 'stack_ref', 'cross_table_ref', 'retired_dropped', 'Retired final ref. Native stack relations and stack record Ids are canonical.'),
  ref('clients', 'client_ref', 'cross_table_ref', 'retired_dropped', 'Retired final ref. Native client relations and client record Ids are canonical.'),
  ref('clients', 'primary_stack_ref', 'cross_table_ref', 'retired_dropped', 'Retired Phase 1 ref. Native rel_clients_primary_stack is canonical.'),
  ref('dolphinProfiles', 'dolphin_profile_ref', 'cross_table_ref', 'retired_dropped', 'Retired final ref. Dolphin profile identity uses dolphin_profile_id plus native relations.'),
  ref('dolphinProfiles', 'client_ref', 'cross_table_ref', 'drop_later_candidate', 'Migration client key; native rel_dolphinProfiles_client is canonical.'),
  ref('outreachSettings', 'outreach_ref', 'own_row_ref', 'drop_later_candidate', 'Own-row migration identifier; keep until jobs stop reporting by it.'),
  ref('outreachSettings', 'client_ref', 'cross_table_ref', 'drop_later_candidate', 'Migration client key; native rel_outreachSettings_client is canonical.'),
  ref('contractsPayments', 'contracts_payments_ref', 'own_row_ref', 'drop_later_candidate', 'Own-row migration identifier; keep until payment repair stops reporting by it.'),
  ref('contractsPayments', 'client_ref', 'cross_table_ref', 'drop_later_candidate', 'Migration client key; native rel_contractsPayments_client is canonical.'),
  ref('platformAccounts', 'platform_account_ref', 'own_row_ref', 'drop_later_candidate', 'Own-row migration identifier; keep until platform account jobs stop reporting by it.'),
  ref('platformAccounts', 'client_ref', 'cross_table_ref', 'drop_later_candidate', 'Migration client key; native rel_platformAccounts_client is canonical.'),
  ref('applications', 'application_ref', 'own_row_ref', 'drop_later_candidate', 'Own-row migration identifier for application rows.'),
  ref('applications', 'client_ref', 'cross_table_ref', 'drop_later_candidate', 'Migration client key; native rel_applications_client is canonical.'),
  ref('restrictions', 'restriction_ref', 'own_row_ref', 'drop_later_candidate', 'Own-row stop-company restriction identifier used in reports.'),
  ref('restrictions', 'client_ref', 'cross_table_ref', 'drop_later_candidate', 'Migration client key; native rel_restrictions_client is canonical.'),
  ref('companies', 'company_ref', 'cross_table_ref', 'retired_dropped', 'Retired Phase 2A ref. Company records and native company relations are canonical.'),
  ref('resumeProfiles', 'resume_sheet_ref', 'own_row_ref', 'drop_later_candidate', 'Own-row resume sheet identifier used for manual overrides and reports.'),
  ref('hhAutoresponses', 'hh_autoresponses_ref', 'own_row_ref', 'drop_later_candidate', 'Own-row HH autoresponses identifier used in legacy reports.'),
  {
    tableKey: 'migrationTraceArchive',
    tableId: 'mcht240r9wx4jrb',
    tableTitle: 'migration_trace_archive',
    columnTitle: 'source_record_ref',
    category: 'archive_ref',
    disposition: 'archive_only_keep',
    rationale: 'Archive/debug value; not a relation key and should remain historical.'
  }
]

const EXPECTED_RELATIONS: ExpectedRelation[] = [
  relation('clients.primary_stack', 'clients', 'rel_clients_primary_stack', 'stacks', 'Native client-to-primary-stack relation replacing primary_stack_ref for relation truth.'),
  relation('dolphinProfiles.client', 'dolphinProfiles', 'rel_dolphinProfiles_client', 'clients', 'Native Dolphin profile to client relation.'),
  relation('outreachSettings.client', 'outreachSettings', 'rel_outreachSettings_client', 'clients', 'Native outreach settings to client relation.'),
  relation('contractsPayments.client', 'contractsPayments', 'rel_contractsPayments_client', 'clients', 'Native contracts/payments to client relation.'),
  relation('platformAccounts.client', 'platformAccounts', 'rel_platformAccounts_client', 'clients', 'Native platform account to client relation.'),
  relation('applications.client', 'applications', 'rel_applications_client', 'clients', 'Native application to client relation.'),
  relation('applications.company', 'applications', 'rel_applications_company', 'companies', 'Native application to company relation.'),
  relation('restrictions.client', 'restrictions', 'rel_restrictions_client', 'clients', 'Native stop-company restriction to client relation.'),
  relation('restrictions.blocked_companies', 'restrictions', 'rel_restrictions_blocked_companies', 'companies', 'Native restriction to blocked companies relation.'),
  relation('dataStatuses.client', 'dataStatuses', 'rel_dataStatuses_client', 'clients', 'Native data collection status to client relation.'),
  relation('resumeProfiles.client', 'resumeProfiles', 'rel_resumeProfiles_client', 'clients', 'Native resume profile to client relation.'),
  relation('hhAutoresponses.client', 'hhAutoresponses', 'rel_hhAutoresponses_client', 'clients', 'Native HH autoresponses row to client relation.'),
  relation('clients.market', 'clients', 'market', 'market', 'Native client to market relation.'),
  relation('applications.market', 'applications', 'rel_applications_market', 'market', 'Native application to market relation.'),
  relation('restrictions.market', 'restrictions', 'rel_restrictions_market', 'market', 'Native restriction to market relation.'),
  relation('mentors.stack', 'mentors', 'Stack', 'stacks', 'Native mentor to stack relation.'),
  relation('mentors.students', 'mentors', 'Students', 'clients', 'Native mentor to students relation.')
]

function ref(
  tableKey: string,
  columnTitle: string,
  category: RefCategory,
  disposition: RefDisposition,
  rationale: string
): RefCandidate {
  const table = TABLES[tableKey]
  if (!table) {
    throw new Error(`Unknown table key in ref candidate: ${tableKey}`)
  }
  return {
    tableKey,
    tableId: table.id,
    tableTitle: table.title,
    columnTitle,
    category,
    disposition,
    rationale
  }
}

function relation(
  key: string,
  tableKey: string,
  title: string,
  relatedTableKey: string,
  rationale: string
): ExpectedRelation {
  const table = TABLES[tableKey]
  const relatedTable = TABLES[relatedTableKey]
  if (!table) {
    throw new Error(`Unknown table key in expected relation: ${tableKey}`)
  }
  if (!relatedTable) {
    throw new Error(`Unknown related table key in expected relation: ${relatedTableKey}`)
  }
  return {
    key,
    tableKey,
    tableId: table.id,
    tableTitle: table.title,
    title,
    relatedTableKey,
    relatedTableId: relatedTable.id,
    acceptableUidts: ['LinkToAnotherRecord', 'Links'],
    rationale
  }
}

function getTableList(tableConfig = TABLES): Array<{ key: string; id: string; title: string }> {
  return Object.values(tableConfig)
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function findColumn(meta: any, title: string): any | undefined {
  return (meta?.columns ?? []).find((column: any) => column.title === title)
}

function relatedTableMatches(column: any, expected: ExpectedRelation): boolean {
  const options = column?.colOptions ?? {}
  const candidates = [
    options.fk_related_model_id,
    options.fk_parent_model_id,
    options.fk_child_model_id,
    options.fk_mm_model_id,
    column?.fk_model_id,
    column?.fk_related_model_id
  ].map(normalize)
  return candidates.includes(normalize(expected.relatedTableId))
}

function classifyColumnPresence(candidate: RefCandidate, metas: Map<string, any>): Record<string, unknown> {
  const meta = metas.get(candidate.tableKey)
  const column = findColumn(meta, candidate.columnTitle)
  return {
    ...candidate,
    present: Boolean(column),
    columnId: column?.id,
    uidt: column?.uidt,
    status: column ? 'present' : 'missing_from_schema'
  }
}

function checkRelationCoverage(expected: ExpectedRelation, metas: Map<string, any>): Record<string, unknown> {
  const meta = metas.get(expected.tableKey)
  const column = findColumn(meta, expected.title)
  const uidtOk = column ? expected.acceptableUidts.includes(column.uidt) : false
  const relatedOk = column ? relatedTableMatches(column, expected) : false
  const ok = Boolean(column) && uidtOk && relatedOk
  return {
    ...expected,
    present: Boolean(column),
    columnId: column?.id,
    uidt: column?.uidt,
    uidtOk,
    relatedOk,
    ok,
    status: ok ? 'ready' : column ? 'relation_metadata_mismatch' : 'missing_relation_column'
  }
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return []
  }

  const result: string[] = []
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name)
    if (item.isDirectory()) {
      if (!['node_modules', 'logs', '.git'].includes(item.name)) {
        result.push(...walkFiles(fullPath))
      }
      continue
    }
    if (CODE_SCAN_EXTENSIONS.has(path.extname(item.name))) {
      result.push(fullPath)
    }
  }
  return result
}

function scanCodeUsage(rootDir = process.cwd(), candidates = REF_CANDIDATES): Array<Record<string, unknown>> {
  const files = CODE_SCAN_DIRS.flatMap(dir => walkFiles(path.join(rootDir, dir)))
    .filter(file => !file.includes(`${path.sep}ref-drop-readiness${path.sep}`))
  const scannedFiles = files.filter(file => {
    const parts = file.split(path.sep)
    return !parts.some(part => CODE_SCAN_EXCLUDED_DIRS.has(part))
  })

  return candidates.map(candidate => {
    const regex = new RegExp(`\\b${candidate.columnTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
    const matches: Array<{ file: string; line: number; text: string }> = []

    for (const file of scannedFiles) {
      const rel = path.relative(rootDir, file)
      const lines: string[] = fs.readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line: string, index: number) => {
        if (regex.test(line)) {
          matches.push({ file: rel, line: index + 1, text: line.trim() })
        }
        regex.lastIndex = 0
      })
    }

    const testMatches = matches.filter(match => /\.test\.[tj]s$/.test(match.file))
    const nonTestMatches = matches.filter(match => !testMatches.includes(match))
    const archivedMatches = nonTestMatches.filter(match => {
      const parts = match.file.split(/[\\/]/)
      return parts.some(part => ARCHIVED_JOB_DIRS.has(part))
    })
    const nonArchivedMatches = nonTestMatches.filter(match => !archivedMatches.includes(match))
    const displayMatches = nonArchivedMatches.filter(isDisplayOrProvenanceUsage)
    const operationalMatches = nonArchivedMatches.filter(match => !displayMatches.includes(match))
    const legacyOnly = operationalMatches.length === 0 && archivedMatches.length > 0

    return {
      tableKey: candidate.tableKey,
      columnTitle: candidate.columnTitle,
      disposition: candidate.disposition,
      usageCount: matches.length,
      operationalUsageCount: operationalMatches.length,
      legacyOnlyUsageCount: archivedMatches.length,
      testUsageCount: testMatches.length,
      displayUsageCount: displayMatches.length,
      archiveProvenanceUsageCount: 0,
      files: [...new Set(matches.map(match => match.file))],
      operationalFiles: [...new Set(operationalMatches.map(match => match.file))],
      legacyOnlyFiles: [...new Set(archivedMatches.map(match => match.file))],
      testFiles: [...new Set(testMatches.map(match => match.file))],
      displayFiles: [...new Set(displayMatches.map(match => match.file))],
      matches: matches.slice(0, 25),
      operationalMatches: operationalMatches.slice(0, 25),
      displayMatches: displayMatches.slice(0, 25),
      status: operationalMatches.length
        ? 'blocked_by_operational_code_usage'
        : legacyOnly
          ? 'legacy_only_usage'
          : 'no_local_usage_found'
    }
  })
}

function buildNoRefFixture(records: Record<string, any[]>): Record<string, any[]> {
  const refTitlesByTable = new Map<string, Set<string>>()
  for (const candidate of REF_CANDIDATES) {
    refTitlesByTable.set(candidate.tableKey, new Set([
      ...(refTitlesByTable.get(candidate.tableKey) ?? []),
      candidate.columnTitle
    ]))
  }

  return Object.fromEntries(
    Object.entries(records).map(([tableKey, rows]) => {
      const titles = refTitlesByTable.get(tableKey) ?? new Set<string>()
      return [
        tableKey,
        rows.map(row => Object.fromEntries(
          Object.entries(row).filter(([key]) => !titles.has(key))
        ))
      ]
    })
  )
}

function summarize(
  refColumns: Array<Record<string, unknown>>,
  relationCoverage: Array<Record<string, unknown>>,
  codeUsage: Array<Record<string, unknown>>
): Record<string, unknown> {
  const dropLater = refColumns.filter(item => item.disposition === 'drop_later_candidate')
  const retiredDropped = refColumns.filter(item => item.disposition === 'retired_dropped')
  const blockers = [
    ...relationCoverage.filter(item => !item.ok).map(item => ({
      kind: 'native_relation_not_ready',
      key: item.key,
      status: item.status
    })),
    ...codeUsage.filter(item => Number(item.operationalUsageCount) > 0).map(item => ({
      kind: 'local_code_uses_ref',
      tableKey: item.tableKey,
      columnTitle: item.columnTitle,
      usageCount: item.operationalUsageCount
    }))
  ]

  return {
    refColumns: refColumns.length,
    dropLaterCandidates: dropLater.length,
    retiredDropped: retiredDropped.length,
    archiveOnlyKeep: refColumns.filter(item => item.disposition === 'archive_only_keep').length,
    missingRefColumns: refColumns.filter(item => !item.present).length,
    expectedNativeRelations: relationCoverage.length,
    readyNativeRelations: relationCoverage.filter(item => item.ok).length,
    blockedNativeRelations: relationCoverage.filter(item => !item.ok).length,
    codeUsageBlockedColumns: codeUsage.filter(item => Number(item.operationalUsageCount) > 0).length,
    archivedUsageColumns: codeUsage.filter(item => Number(item.legacyOnlyUsageCount) > 0).length,
    displayOnlyUsageColumns: codeUsage.filter(item => Number(item.operationalUsageCount) === 0 && Number(item.displayUsageCount) > 0).length,
    legacyOnlyUsageColumns: codeUsage.filter(item => Number(item.operationalUsageCount) === 0 && Number(item.legacyOnlyUsageCount) > 0).length,
    readyToDropAnyRefColumns: false,
    blockers
  }
}

function buildFutureDropPlan(refColumns: Array<Record<string, unknown>>, codeUsage: Array<Record<string, unknown>>): Record<string, unknown> {
  function phase2Status(usage: Record<string, unknown> | undefined): string {
    const operational = Number(usage?.operationalUsageCount ?? 0)
    const display = Number(usage?.displayUsageCount ?? 0)
    const legacy = Number(usage?.legacyOnlyUsageCount ?? 0)
    const tests = Number(usage?.testUsageCount ?? 0)
    const legacyFiles = Array.isArray(usage?.legacyOnlyFiles) ? usage.legacyOnlyFiles as string[] : []
    const retiredArchiveOnly = legacyFiles.every(file => {
      const parts = file.split(/[\\/]/)
      return parts.some(part => RETIRED_ARCHIVED_JOB_DIRS.has(part))
    })
    if (operational > 0) {
      return 'blocked_by_operational_usage'
    }
    if (display > 0) {
      return 'external_display_only'
    }
    if (tests > 0) {
      return 'test_only_usage'
    }
    if (legacy > 0) {
      return retiredArchiveOnly ? 'retired_archive_usage' : 'archive_only_usage'
    }
    return 'ready_for_drop_prep'
  }

  return {
    approvedToApply: false,
    reason: 'Preparation only. Refactor jobs and rerun no-ref verification before deleting any ref columns.',
    phases: [
      {
        phase: 1,
        name: 'own_row_refs_after_refactor',
        description: 'Own-row migration/debug identifiers that may be removable after local code stops reading them.',
        columns: refColumns
          .filter(column => column.disposition === 'drop_later_candidate')
          .map(column => {
            const usage = codeUsage.find(item => item.tableKey === column.tableKey && item.columnTitle === column.columnTitle)
            return {
              tableKey: column.tableKey,
              tableId: column.tableId,
              tableTitle: column.tableTitle,
              columnId: column.columnId,
              columnTitle: column.columnTitle,
              present: column.present,
              blocked: Number(usage?.operationalUsageCount ?? 0) > 0,
              blocker: Number(usage?.operationalUsageCount ?? 0) > 0 ? 'operational_code_usage' : undefined,
              usageCount: usage?.usageCount ?? 0,
              operationalUsageCount: usage?.operationalUsageCount ?? 0,
              legacyOnlyUsageCount: usage?.legacyOnlyUsageCount ?? 0,
              testUsageCount: usage?.testUsageCount ?? 0,
              displayUsageCount: usage?.displayUsageCount ?? 0
            }
          })
      },
      {
        phase: 2,
        name: 'retired_cross_table_refs',
        description: 'Cross-table migration refs already dropped from Noco. Retired archive usage is documented but non-blocking.',
        columns: refColumns
          .filter(column => column.disposition === 'retired_dropped')
          .map(column => {
            const usage = codeUsage.find(item => item.tableKey === column.tableKey && item.columnTitle === column.columnTitle)
            const status = phase2Status(usage)
            const blocked = !['ready_for_drop_prep', 'retired_archive_usage'].includes(status)
            return {
              tableKey: column.tableKey,
              tableId: column.tableId,
              tableTitle: column.tableTitle,
              columnId: column.columnId,
              columnTitle: column.columnTitle,
              present: column.present,
              blocked,
              blocker: blocked ? status : undefined,
              phase2Status: status,
              usageCount: usage?.usageCount ?? 0,
              operationalUsageCount: usage?.operationalUsageCount ?? 0,
              legacyOnlyUsageCount: usage?.legacyOnlyUsageCount ?? 0,
              testUsageCount: usage?.testUsageCount ?? 0,
              displayUsageCount: usage?.displayUsageCount ?? 0
            }
          })
      }
    ],
    neverDropInThisPlan: refColumns
      .filter(column => column.disposition === 'archive_only_keep')
      .map(column => ({
        tableKey: column.tableKey,
        tableId: column.tableId,
        tableTitle: column.tableTitle,
        columnId: column.columnId,
        columnTitle: column.columnTitle,
        reason: column.rationale
      }))
  }
}

function renderMarkdown(summary: Record<string, any>, refColumns: any[], relationCoverage: any[], codeUsage: any[]): string {
  const lines = [
    '# Ref Drop Readiness',
    '',
    'This is a read-only report. It does not approve dropping any `*_ref` column.',
    '',
    '## Summary',
    '',
    `- Ref columns frozen: ${summary.refColumns}`,
    `- Drop-later candidates: ${summary.dropLaterCandidates}`,
    `- Retired/dropped refs: ${summary.retiredDropped}`,
    `- Native relations ready: ${summary.readyNativeRelations}/${summary.expectedNativeRelations}`,
    `- Columns still referenced by operational code: ${summary.codeUsageBlockedColumns}`,
    `- Columns referenced by archived jobs: ${summary.archivedUsageColumns}`,
    `- Columns referenced only for display/provenance: ${summary.displayOnlyUsageColumns}`,
    `- Columns referenced only by archived jobs: ${summary.legacyOnlyUsageColumns}`,
    `- Ready to drop now: ${summary.readyToDropAnyRefColumns ? 'yes' : 'no'}`,
    '',
    '## Drop-Later Candidates',
    '',
    '| Table | Column | Present | Operational usage | Legacy-only usage |',
    '|---|---|---:|---:|---:|'
  ]

  for (const item of refColumns.filter(column => column.disposition === 'drop_later_candidate')) {
    const usage = codeUsage.find(usageItem => usageItem.tableKey === item.tableKey && usageItem.columnTitle === item.columnTitle)
    lines.push(`| ${item.tableTitle} | ${item.columnTitle} | ${item.present ? 'yes' : 'no'} | ${usage?.operationalUsageCount ?? 0} | ${usage?.legacyOnlyUsageCount ?? 0} |`)
  }

  lines.push(
    '',
    '## Retired/Dropped Refs',
    '',
    '| Table | Column | Reason |',
    '|---|---|---|'
  )
  for (const item of refColumns.filter(column => column.disposition === 'retired_dropped')) {
    lines.push(`| ${item.tableTitle} | ${item.columnTitle} | ${item.rationale} |`)
  }

  lines.push(
    '',
    '## Native Relation Coverage',
    '',
    '| Relation | Field | Status |',
    '|---|---|---|'
  )
  for (const relation of relationCoverage) {
    lines.push(`| ${relation.key} | ${relation.title} | ${relation.status} |`)
  }

  return `${lines.join('\n')}\n`
}

async function fetchMetas(client: any): Promise<Map<string, any>> {
  const metas = new Map<string, any>()
  for (const table of getTableList()) {
    metas.set(table.key, await client.fetchTableMeta(table.id))
    await client.wait(120)
  }
  metas.set('migrationTraceArchive', await client.fetchTableMeta('mcht240r9wx4jrb'))
  return metas
}

async function runDryRun(): Promise<void> {
  const client = createNocoClient()
  const dir = createReportDir(JOB_NAME)
  const metas = await fetchMetas(client)
  const refColumns = REF_CANDIDATES.map(candidate => classifyColumnPresence(candidate, metas))
  const relationCoverage = EXPECTED_RELATIONS.map(expected => checkRelationCoverage(expected, metas))
  const codeUsage = scanCodeUsage()
  const summary = summarize(refColumns, relationCoverage, codeUsage)

  writeJson(dir, 'summary.json', summary)
  writeJson(dir, 'ref-candidates.json', refColumns)
  writeJson(dir, 'native-relation-coverage.json', relationCoverage)
  writeJson(dir, 'code-usage.json', codeUsage)
  writeJson(dir, 'future-drop-plan.json', buildFutureDropPlan(refColumns, codeUsage))
  writeJson(dir, 'archive-strategy.json', {
    currentBackupRequired: true,
    currentBackupLocation: 'logs/nocodb-full-backup/latest.txt',
    minimumBeforeDrop: [
      'Run noco:full-backup:apply and keep the generated directory.',
      'Rerun noco:ref-drop-readiness:dry-run and confirm no phase-1 columns are blocked by code usage.',
      'Run the full dry-run suite after refactoring jobs away from refs.',
      'Only then create a separate exact column-delete allowlist.'
    ],
    note: 'This job does not create dropped_ref_archive because no columns are being dropped in this phase.'
  })
  writeJson(dir, 'no-ref-fixture-guide.json', {
    purpose: 'Fixture helper for future refactors: remove candidate ref keys from records and verify jobs still pass.',
    candidateColumns: REF_CANDIDATES.map(candidate => ({
      tableKey: candidate.tableKey,
      columnTitle: candidate.columnTitle,
      disposition: candidate.disposition
    }))
  })
  writeText(dir, 'manual-review.md', renderMarkdown(summary, refColumns, relationCoverage, codeUsage))
  writeJson(dir, 'apply-result.json', {
    mode: 'dry-run',
    applied: false,
    reason: 'This job is read-only. It never drops columns.'
  })

  console.log(`NocoDB ref-drop readiness dry-run written to ${dir}`)
  console.log(JSON.stringify(summary, null, 2))
}

function runTests(): void {
  const metas = new Map<string, any>([
    ['clients', {
      columns: [
        { title: 'client_ref', id: 'client_ref_id', uidt: 'SingleLineText' },
        {
          title: 'rel_clients_primary_stack',
          id: 'rel_stack_id',
          uidt: 'LinkToAnotherRecord',
          colOptions: { fk_related_model_id: TABLES.stacks.id }
        }
      ]
    }],
    ['stacks', { columns: [{ title: 'stack_ref', id: 'stack_ref_id', uidt: 'SingleLineText' }] }]
  ])
  const clientRef = classifyColumnPresence(ref('clients', 'client_ref', 'cross_table_ref', 'retired_dropped', 'test'), metas)
  assert.equal(clientRef.present, true)
  const coverage = checkRelationCoverage(EXPECTED_RELATIONS[0], metas)
  assert.equal(coverage.ok, true)
  const noRef = buildNoRefFixture({
    clients: [{ Id: 1, client_ref: 'client_kira', client_name: 'Kira' }],
    stacks: [{ Id: 1, stack_ref: 'stack_js', stack: 'JS' }]
  })
  assert.deepEqual(noRef.clients, [{ Id: 1, client_name: 'Kira' }])
  assert.deepEqual(noRef.stacks, [{ Id: 1, stack: 'JS' }])
}

async function main(): Promise<void> {
  const args = parseJobArgs()
  if (args.test) {
    runTests()
    console.log('noco:ref-drop-readiness tests passed')
    return
  }
  if (args.apply) {
    throw new Error('ref-drop-readiness is read-only. Use --dry-run.')
  }
  await runDryRun()
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(describeError(error))
    process.exitCode = 1
  })
}

module.exports = {
  EXPECTED_RELATIONS,
  REF_CANDIDATES,
  buildNoRefFixture,
  checkRelationCoverage,
  classifyColumnPresence,
  scanCodeUsage,
  summarize
}
