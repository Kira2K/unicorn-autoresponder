import type { Cell, Resource, ResourceReference, SheetAudit, SourceLayout, WorkbookSnapshot } from './types.ts'

const value = (cell?: Cell) => cell?.formattedValue ?? cell?.userEnteredValue?.stringValue ?? ''
function columnName(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name
  return name
}
/** Link metadata wins over labels. Only literal HYPERLINK URLs are parsed; formulas are never executed. */
function links(cell?: Cell): string[] {
  if (!cell) return []
  const embedded = [cell.hyperlink, ...(cell.textFormatRuns ?? []).map(run => run.format?.link?.uri)].filter((v): v is string => !!v)
  if (embedded.length) return [...new Set(embedded)]
  const literal = cell.userEnteredValue?.formulaValue?.match(/^=HYPERLINK\(\s*"([^"]+)"/i)?.[1]
  if (literal) return [literal]
  return value(cell).match(/(?:https?:\/\/|\bwww\.|\bt\.me\/)[^\s<>"|]+/gi)?.map(url => /^https?:/i.test(url) ? url : `https://${url}`) ?? []
}

export function readGoogleSheetSources(snapshot: WorkbookSnapshot, layout: SourceLayout): { entries: Resource[]; sheetAudit: SheetAudit[] } {
  if (snapshot.metadata.id !== snapshot.spreadsheet.spreadsheetId) throw Error('source_file_identity_mismatch')
  if (snapshot.metadata.mime_type !== 'application/vnd.google-apps.spreadsheet') throw Error('native_google_sheet_required')
  if (!Number.isFinite(Date.parse(snapshot.fetchedAt))) throw Error('source_read_timestamp_required')
  const entries: Resource[] = [], sheetAudit: SheetAudit[] = []
  for (const sheet of snapshot.spreadsheet.sheets) {
    const { title, sheetId, hidden } = sheet.properties, rule = layout.sheets.find(s => s.title === title)
    const audit: SheetAudit = { title, sheetId, status: 'processed', rows: 0, occurrences: 0, reason: 'snapshot_links_processed; websites_not_inspected' }
    sheetAudit.push(audit)
    if (hidden || rule?.kind === 'reference') { audit.status = 'skipped'; audit.reason = hidden ? 'hidden_archive_not_activated' : rule!.reason ?? 'reference_only'; continue }
    if (!rule) { audit.status = 'review'; audit.reason = 'sheet_layout_required'; continue }
    if (!sheet.data) { audit.status = 'unavailable'; audit.reason = 'sheet_contents_not_read'; continue }
    const rows = new Map<number, Record<string, Cell>>()
    for (const block of sheet.data) for (const [i, row] of (block.rowData ?? []).entries()) {
      const rowNumber = (block.startRow ?? 0) + i + 1, cells = rows.get(rowNumber) ?? {}
      for (const [j, cell] of (row.values ?? []).entries()) cells[columnName((block.startColumn ?? 0) + j)] = cell
      rows.set(rowNumber, cells)
    }
    for (const [row, cells] of rows) {
      if (row < (rule.firstRow ?? 2)) continue
      const nameColumn = rule.nameColumns?.find(col => value(cells[col]).trim())
      const name = nameColumn ? value(cells[nameColumn]).trim() : ''
      const notes = (rule.noteColumns ?? []).map(col => value(cells[col]).trim()).filter(Boolean).join('; ')
      const reference = (column: string): ResourceReference => ({ registryPath: snapshot.registryPath,
        workbook: { fileId: snapshot.metadata.id, fileName: snapshot.metadata.title, sheet: title, row, companyCell: `${nameColumn ?? column}${row}`, careerCell: `${column}${row}` },
        ...(value(cells[column]) ? { displayedValue: value(cells[column]) } : {}), ...(notes ? { notes } : {}) })
      // Company URL columns are ordered fallbacks. Vacancy sheets may contain several independent link columns.
      const columns = rule.urlColumns ?? Object.keys(cells)
      const primary = rule.kind === 'company' ? columns.filter(col => links(cells[col]).length).slice(0, 1) : columns
      const rowEntries: Resource[] = []
      for (const column of [...primary, ...(rule.auxiliaryUrlColumns ?? [])]) for (const url of links(cells[column])) {
        rowEntries.push({ name: name || title, kind: rule.kind, url, references: [reference(column)], status: 'review', reason: 'unrouted_source', ...(rule.stackHint ? { stackHint: rule.stackHint } : {}) })
      }
      if (!primary.some(col => links(cells[col]).length) && name) rowEntries.unshift({ name, kind: rule.kind, references: [reference(columns[0] ?? nameColumn!)], status: 'review', reason: 'missing_url' })
      if (rowEntries.length) { audit.rows++; audit.occurrences += rowEntries.length; entries.push(...rowEntries) }
    }
  }
  for (const rule of layout.sheets) if (!snapshot.spreadsheet.sheets.some(s => s.properties.title === rule.title)) {
    sheetAudit.push({ title: rule.title, sheetId: -1, status: 'unavailable', rows: 0, occurrences: 0, reason: 'configured_sheet_missing' })
  }
  return { entries, sheetAudit }
}
