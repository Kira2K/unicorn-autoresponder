const assert = require('node:assert/strict')

const { createNocoClient } = require('../core/client.ts') as {
  createNocoClient(options?: any): any
}
const { describeError } = require('../core/errors.ts') as {
  describeError(error: any): string
}
const { parseJobArgs } = require('../core/job.ts') as {
  parseJobArgs(args?: string[]): { apply: boolean; dryRun: boolean; test: boolean; mode: string }
}
const { createReportDir, writeJson } = require('../core/reports.ts') as {
  createReportDir(jobName: string): string
  writeJson(dir: string, fileName: string, data: unknown): void
}
const { getLinkedRecord } = require('../core/relations.ts') as {
  getLinkedRecord(value: unknown): Record<string, unknown> | null
}
const { TABLES } = require('../core/schema.ts') as {
  TABLES: Record<string, { id: string; title: string }>
}
const { normalizeLookupText, normalizeText } = require('../core/text.ts') as {
  normalizeLookupText(value: unknown): string
  normalizeText(value: unknown): string
}
type ClientStatus =
  | 'studying'
  | 'on ru market'
  | 'on en market'
  | 'paused'
  | 'graduated'
  | 'blacklisted'
  | 'left'
  | 'unknown'

type NocoRecord = Record<string, unknown> & { Id: number }

type SheetStatusRow = {
  rowNumber: number
  stack: string
  name: string
  rawStatus: string
  ruResponses: string
  enResponses: string
  vuResponses: string
  comments: string[]
}

type StatusProposal = {
  recordId: number
  clientLabel: string
  clientName: string
  fio: string
  before: unknown
  after: ClientStatus
  stackStatus?: ClientStatus
  stackWillClear: boolean
  note: string
  noteAfter: string | null
  source: string
  confidence: 'sheet' | 'noco' | 'unknown'
  conflicts: string[]
  patch: Record<string, unknown>
}

type MatchResult = {
  row?: SheetStatusRow
  status: 'matched' | 'unmatched' | 'ambiguous'
  candidates: SheetStatusRow[]
}

const JOB_NAME = 'nocodb-client-status'
const STATUS_SHEET_ID = '1aKBY4omgfcdWqmCBoh4O5ALPY5FoxfNAbRg5sGcfGBY'
const STATUS_SHEET_NAME = 'Статус откликов'
const STATUS_VALUES: ClientStatus[] = [
  'studying',
  'on ru market',
  'on en market',
  'paused',
  'graduated',
  'blacklisted',
  'left',
  'unknown'
]

function normalizeHeader(value: unknown): string {
  return normalizeLookupText(value).replace(/[._-]+/g, ' ')
}

function isYes(value: unknown): boolean {
  const normalized = normalizeLookupText(value)
  return ['да', 'yes', 'true', '1', '+'].includes(normalized)
}

function hasNo(value: unknown): boolean {
  const normalized = normalizeLookupText(value)
  return ['нет', 'no', 'false', '0', '-'].includes(normalized)
}

function findHeaderIndex(headers: string[], patterns: string[]): number | undefined {
  const normalizedPatterns = patterns.map(normalizeHeader)
  const index = headers.findIndex(header =>
    normalizedPatterns.some(pattern => header === pattern || header.includes(pattern))
  )
  return index === -1 ? undefined : index
}

function parseStatusSheetRows(values: string[][]): SheetStatusRow[] {
  const headerIndex = values.findIndex(row =>
    row.some(cell => normalizeHeader(cell) === 'статус') &&
    row.some(cell => normalizeHeader(cell).includes('отклики ru'))
  )

  if (headerIndex === -1) {
    throw new Error(`Could not find the header row in "${STATUS_SHEET_NAME}".`)
  }

  const headers = (values[headerIndex] ?? []).map(normalizeHeader)
  const statusIndex = findHeaderIndex(headers, ['статус'])
  const ruIndex = findHeaderIndex(headers, ['отклики ru'])
  const enIndex = findHeaderIndex(headers, ['отклики en'])
  const vuIndex = findHeaderIndex(headers, ['отклики ву', 'отклики vu'])
  const commentIndexes = headers
    .map((header, index) => ({ header, index }))
    .filter(item => item.header === 'комментарий')
    .map(item => item.index)

  if (statusIndex === undefined || ruIndex === undefined || enIndex === undefined) {
    throw new Error('Required status sheet columns were not found.')
  }

  const rows: SheetStatusRow[] = []
  let currentStack = ''

  for (let index = headerIndex + 1; index < values.length; index += 1) {
    const row = values[index] ?? []
    const stack = normalizeText(row[0])
    const name = normalizeText(row[1])

    if (stack) {
      currentStack = stack
    }
    if (!name || name.toLowerCase().includes('гайд')) {
      continue
    }

    rows.push({
      rowNumber: index + 1,
      stack: currentStack,
      name,
      rawStatus: normalizeText(row[statusIndex]),
      ruResponses: normalizeText(row[ruIndex]),
      enResponses: normalizeText(row[enIndex]),
      vuResponses: vuIndex === undefined ? '' : normalizeText(row[vuIndex]),
      comments: commentIndexes.map(commentIndex => normalizeText(row[commentIndex])).filter(Boolean)
    })
  }

  return rows
}

function firstLastKey(value: unknown): string {
  const words = normalizeLookupText(value).split(' ').filter(Boolean)
  return words.length >= 2 ? `${words[0]} ${words[1]}` : words[0] ?? ''
}

function reverseFirstLastKey(value: unknown): string {
  const words = normalizeLookupText(value).split(' ').filter(Boolean)
  return words.length >= 2 ? `${words[1]} ${words[0]}` : ''
}

function buildSheetIndexes(rows: SheetStatusRow[]): Map<string, SheetStatusRow[]> {
  const indexes = new Map<string, SheetStatusRow[]>()
  const add = (key: string, row: SheetStatusRow) => {
    if (!key) {
      return
    }
    indexes.set(key, [...(indexes.get(key) ?? []), row])
  }

  for (const row of rows) {
    add(normalizeLookupText(row.name), row)
    add(firstLastKey(row.name), row)
    add(reverseFirstLastKey(row.name), row)
  }

  return indexes
}

function matchSheetRow(record: NocoRecord, indexes: Map<string, SheetStatusRow[]>): MatchResult {
  const keys = [
    normalizeLookupText(record.client_name),
    firstLastKey(record.client_name),
    firstLastKey(record.fio),
    reverseFirstLastKey(record.fio)
  ].filter(Boolean)
  const candidates = new Map<number, SheetStatusRow>()

  for (const key of keys) {
    for (const row of indexes.get(key) ?? []) {
      candidates.set(row.rowNumber, row)
    }
  }

  const unique = [...candidates.values()]
  if (unique.length === 1) {
    return { row: unique[0], status: 'matched', candidates: unique }
  }
  if (unique.length > 1) {
    return { status: 'ambiguous', candidates: unique }
  }
  return { status: 'unmatched', candidates: [] }
}

function statusFromText(value: unknown): ClientStatus | undefined {
  const text = normalizeLookupText(value)

  if (!text) {
    return undefined
  }
  if (/(^|[^а-яa-z])чс([^а-яa-z]|$)|blacklist/.test(text)) {
    return 'blacklisted'
  }
  if (text.includes('ушли') || text.includes('ушел') || text.includes('ушла') || text.includes('left')) {
    return 'left'
  }
  if (text.includes('выпуст')) {
    return 'graduated'
  }
  if (text.includes('пауза') || text.includes('paused')) {
    return 'paused'
  }
  if (text.includes('ву') || text.includes('en') || text.includes('english')) {
    return 'on en market'
  }
  if (text.includes('ру') || text.includes(' ru') || text.includes('оклики на ру') || text.includes('отклики на ру')) {
    return 'on ru market'
  }
  if (text.includes('учит') || text.includes('учеб') || text.includes('training') || text.includes('study')) {
    return 'studying'
  }

  return undefined
}

function statusFromStackText(value: unknown): ClientStatus | undefined {
  const text = normalizeLookupText(value)

  if (!text) {
    return undefined
  }
  if (text === 'чс' || text === 'stack_чс') {
    return 'blacklisted'
  }
  if (text === 'ушли' || text === 'stack_ушли') {
    return 'left'
  }
  if (text === 'выпуск' || text === 'stack_выпуск') {
    return 'graduated'
  }

  return undefined
}

function inferStatusFromNoco(record: NocoRecord): ClientStatus | undefined {
  return inferStatusFromStack(record)
}

function inferStatusFromStack(record: NocoRecord): ClientStatus | undefined {
  const linkedStack = getLinkedRecord(record.rel_clients_primary_stack)
  return (
    statusFromStackText(linkedStack?.name) ??
    statusFromStackText(linkedStack?.stack)
  )
}

function inferStatusFromSheet(row: SheetStatusRow): ClientStatus {
  const sheetStatus = normalizeLookupText(row.rawStatus)
  const ruActive = isYes(row.ruResponses)
  const enActive = isYes(row.enResponses)
  const vuActive = isYes(row.vuResponses)

  if (sheetStatus.includes('выпуст')) {
    return 'graduated'
  }
  if (sheetStatus.includes('пауза')) {
    return 'paused'
  }
  if (sheetStatus.includes('чс')) {
    return 'blacklisted'
  }
  if (sheetStatus.includes('ушли')) {
    return 'left'
  }
  if (enActive || vuActive) {
    return 'on en market'
  }
  if (ruActive) {
    return 'on ru market'
  }
  if (sheetStatus.includes('актив')) {
    return 'studying'
  }

  return 'unknown'
}

function isClientStatus(value: unknown): value is ClientStatus {
  return STATUS_VALUES.includes(value as ClientStatus)
}

function buildSheetNote(row: SheetStatusRow | undefined, matchStatus: MatchResult['status']): string {
  if (!row) {
    return matchStatus === 'ambiguous'
      ? 'Status not updated from sheet: ambiguous name match.'
      : ''
  }

  const parts = [
    `sheet row ${row.rowNumber}`,
    row.rawStatus ? `status=${row.rawStatus}` : '',
    row.ruResponses ? `RU=${row.ruResponses}` : '',
    row.enResponses ? `EN=${row.enResponses}` : '',
    row.vuResponses ? `VU=${row.vuResponses}` : '',
    ...row.comments
  ].filter(Boolean)

  return parts.join('; ')
}

function legacyNoteParts(value: unknown): string[] {
  return normalizeText(value)
    .split(';')
    .map(part => part.trim())
    .filter(part => /^legacy (current_status|stack_status):/.test(part))
}

function appendNote(
  baseNote: string,
  existingNote: unknown,
  stackStatusText: string
): string {
  const legacyStackLine = stackStatusText ? `legacy stack_status: ${stackStatusText}` : ''
  const parts = [baseNote, ...legacyNoteParts(existingNote), legacyStackLine].filter(Boolean)
  const deduped: string[] = []

  for (const part of parts) {
    if (!deduped.includes(part)) {
      deduped.push(part)
    }
  }

  return deduped.join('; ')
}

function existingWorkbookNoteForRow(existingNote: unknown, row: SheetStatusRow | undefined): string {
  const note = normalizeText(existingNote)
  if (row && note.startsWith(`workbook ${STATUS_SHEET_NAME}!${row.rowNumber}`)) {
    return note
  }
  return ''
}

function detectConflicts(record: NocoRecord, row: SheetStatusRow | undefined, match: MatchResult): string[] {
  const conflicts: string[] = []
  const nocoStatus = inferStatusFromNoco(record)

  if (match.status === 'ambiguous') {
    conflicts.push(`ambiguous sheet match: ${match.candidates.map(candidate => candidate.name).join(', ')}`)
  }

  if (row && ['blacklisted', 'left'].includes(String(nocoStatus)) && normalizeLookupText(row.rawStatus).includes('актив')) {
    conflicts.push(`Noco lifecycle status looks ${nocoStatus}, but sheet says active`)
  }

  if (
    row &&
    normalizeLookupText(row.rawStatus).includes('актив') &&
    hasNo(row.ruResponses) &&
    hasNo(row.enResponses) &&
    (row.vuResponses ? hasNo(row.vuResponses) : true)
  ) {
    conflicts.push('sheet says active, but RU/EN/VU response flags are all no')
  }

  return conflicts
}

function buildStatusProposals(records: NocoRecord[], sheetRows: SheetStatusRow[]): StatusProposal[] {
  const indexes = buildSheetIndexes(sheetRows)

  return records.map(record => {
    const match = matchSheetRow(record, indexes)
    const row = match.status === 'matched' ? match.row : undefined
    const stackStatus = inferStatusFromStack(record)
    const linkedStack = getLinkedRecord(record.rel_clients_primary_stack)
    const stackStatusText = stackStatus
      ? normalizeText(linkedStack?.name)
      : ''
    const nocoStatus = inferStatusFromNoco(record)
    const existingStatus = isClientStatus(record.client_status) ? record.client_status : undefined
    const sheetStatus = row ? inferStatusFromSheet(row) : undefined
    const conflicts = detectConflicts(record, row, match)
    const after =
      conflicts.length && existingStatus
        ? existingStatus
        : sheetStatus ?? nocoStatus ?? existingStatus ?? 'unknown'
    const existingNote = normalizeText(record.client_status_note)
    const note =
      existingWorkbookNoteForRow(record.client_status_note, row) ||
      existingNote ||
      appendNote(
        match.status === 'ambiguous' ? buildSheetNote(row, match.status) : '',
        record.client_status_note,
        stackStatusText
      )
    const noteAfter = note || null
    const patch: Record<string, unknown> = {}
    const stackWillClear = false

    if (record.client_status !== after) {
      patch.client_status = after
    }
    if ((record.client_status_note ?? null) !== noteAfter) {
      patch.client_status_note = noteAfter
    }

    return {
      recordId: record.Id,
      clientLabel: `${record.Id} ${String(record.client_name ?? '')}`.trim(),
      clientName: String(record.client_name ?? ''),
      fio: String(record.fio ?? ''),
      before: record.client_status ?? null,
      after,
      stackStatus,
      stackWillClear,
      note: buildSheetNote(row, match.status),
      noteAfter,
      source: row ? `${STATUS_SHEET_NAME}!${row.rowNumber}` : 'noco.client_status',
      confidence: row ? 'sheet' : nocoStatus ? 'noco' : existingStatus ? 'noco' : 'unknown',
      conflicts,
      patch
    }
  })
}

function summarize(proposals: StatusProposal[]): Record<string, unknown> {
  const statusCounts = Object.fromEntries(
    STATUS_VALUES.map(status => [status, proposals.filter(item => item.after === status).length])
  )
  const patches = proposals.filter(item => Object.keys(item.patch).length && !item.conflicts.length)
  const conflicts = proposals.filter(item => item.conflicts.length)

  return {
    total: proposals.length,
    patches: patches.length,
    conflicts: conflicts.length,
    statusChanges: proposals.filter(item => item.before !== item.after).length,
    currentStatusClears: 0,
    stackClears: proposals.filter(item => item.stackWillClear).length,
    byStatus: statusCounts,
    byConfidence: {
      sheet: proposals.filter(item => item.confidence === 'sheet').length,
      noco: proposals.filter(item => item.confidence === 'noco').length,
      unknown: proposals.filter(item => item.confidence === 'unknown').length
    }
  }
}

async function fetchSheetRows(): Promise<{ info: Record<string, unknown>; rows: SheetStatusRow[] }> {
  const previousSheetId = process.env.google_spreadsheet_id
  process.env.google_spreadsheet_id = process.env.CLIENT_STATUS_SPREADSHEET_ID || STATUS_SHEET_ID
  try {
    const { fetchSheetValues } = require('../integrations/google-sheets.ts') as {
      fetchSheetValues(sheetNames: string[]): Promise<{
        spreadsheet?: { id: string; name: string }
        spreadsheetTitle: string
        sheets: Array<{ title: string; values: string[][] }>
      }>
    }
    const result = await fetchSheetValues([STATUS_SHEET_NAME])
    return {
      info: {
        spreadsheetId: result.spreadsheet?.id ?? STATUS_SHEET_ID,
        spreadsheetTitle: result.spreadsheetTitle,
        sheetName: result.sheets[0]?.title ?? STATUS_SHEET_NAME
      },
      rows: parseStatusSheetRows(result.sheets[0]?.values ?? [])
    }
  } finally {
    if (previousSheetId === undefined) {
      delete process.env.google_spreadsheet_id
    } else {
      process.env.google_spreadsheet_id = previousSheetId
    }
  }
}

async function run(apply: boolean): Promise<void> {
  if (apply) {
    throw new Error('noco:client-status is read-only. Apply mode is intentionally unsupported.')
  }

  const client = createNocoClient()
  const dir = createReportDir(JOB_NAME)
  const sheet = await fetchSheetRows()
  const records: NocoRecord[] = await client.fetchRecords(TABLES.clients.id, 1000)
  const proposals = buildStatusProposals(records, sheet.rows)
  const patches = proposals.filter(item => Object.keys(item.patch).length && !item.conflicts.length)
  const conflicts = proposals.filter(item => item.conflicts.length)
  const summary = summarize(proposals)

  writeJson(dir, 'summary.json', { mode: apply ? 'apply' : 'dry-run', sheet: sheet.info, ...summary })
  writeJson(dir, 'sheet-status-rows.json', sheet.rows)
  writeJson(dir, 'proposals.json', proposals)
  writeJson(dir, 'patches.json', patches)
  writeJson(dir, 'conflicts.json', conflicts)

  writeJson(dir, 'apply-result.json', { mode: 'dry-run', applied: false })
  console.log(`NocoDB client status dry-run written to ${dir}`)
  console.log(JSON.stringify(summary, null, 2))
}

function runTests(): void {
  const rows = parseStatusSheetRows([
    ['АКТУАЛЬНО', '', 'Статус', 'Отклики RU', 'Отклики EN', '', '', '', '', 'Комментарий'],
    ['Python', 'Both', 'активен', 'да', 'да'],
    ['Python', 'Ru Only', 'активен', 'да', 'нет'],
    ['Python', 'En Only', 'активен', 'нет', 'да'],
    ['Python', 'Paused', 'пауза', 'нет', 'да'],
    ['Python', 'Graduated', 'выпустился', 'нет', 'нет'],
    ['Python', 'Training', 'активен', 'нет', 'нет']
  ])
  const byName = new Map(rows.map(row => [row.name, row]))

  assert.equal(inferStatusFromSheet(byName.get('Both') as SheetStatusRow), 'on en market')
  assert.equal(inferStatusFromSheet(byName.get('Ru Only') as SheetStatusRow), 'on ru market')
  assert.equal(inferStatusFromSheet(byName.get('En Only') as SheetStatusRow), 'on en market')
  assert.equal(inferStatusFromSheet(byName.get('Paused') as SheetStatusRow), 'paused')
  assert.equal(inferStatusFromSheet(byName.get('Graduated') as SheetStatusRow), 'graduated')
  assert.equal(inferStatusFromSheet(byName.get('Training') as SheetStatusRow), 'studying')
  assert.equal(statusFromText('ЧС'), 'blacklisted')
  assert.equal(statusFromText('УШЛИ'), 'left')
  assert.equal(statusFromStackText('ЧС'), 'blacklisted')
  assert.equal(statusFromStackText('УШЛИ'), 'left')
  assert.equal(statusFromStackText('ВЫПУСК'), 'graduated')
  assert.equal(
    inferStatusFromNoco({
      Id: 1,
      rel_clients_primary_stack: { Id: 1, name: 'ЧС' }
    }),
    'blacklisted'
  )
  assert.equal(
    buildStatusProposals([{ Id: 1, client_status: 'blacklisted' }], [])[0].after,
    'blacklisted'
  )
  const leftStackProposal = buildStatusProposals(
    [{ Id: 1, client_status: 'studying', rel_clients_primary_stack: { Id: 1, name: 'УШЛИ' } }],
    []
  )[0]
  assert.equal(leftStackProposal.after, 'left')
  assert.match(String(leftStackProposal.patch.client_status_note), /legacy stack_status: УШЛИ/)
  assert.equal('primary_stack' in leftStackProposal.patch, false)
  assert.equal('current_status' in leftStackProposal.patch, false)
}

async function main(): Promise<void> {
  const args = parseJobArgs()
  if (args.test) {
    runTests()
    console.log('noco:client-status tests passed')
    return
  }

  await run(args.apply)
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(describeError(error))
    process.exitCode = 1
  })
}

module.exports = {
  STATUS_VALUES,
  buildStatusProposals,
  inferStatusFromNoco,
  inferStatusFromSheet,
  parseStatusSheetRows,
  statusFromText,
  summarize
}
