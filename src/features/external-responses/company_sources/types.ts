import type { Source, WorkbookReference } from '../types.ts'

export type ResourceKind = 'company' | 'aggregator' | 'telegram' | 'vacancy_seed' | 'reference'
export type Cell = { formattedValue?: string; hyperlink?: string; userEnteredValue?: { stringValue?: string; formulaValue?: string }; textFormatRuns?: { format?: { link?: { uri?: string } } }[] }
export type Sheet = {
  properties: { title: string; sheetId: number; hidden?: boolean }
  data?: { startRow?: number; startColumn?: number; rowData?: { values?: Cell[] }[] }[]
}
export type WorkbookSnapshot = {
  version: 1; registryPath: string; fetchedAt: string
  metadata: { id: string; title: string; mime_type: string }
  spreadsheet: { spreadsheetId: string; sheets: Sheet[] }
}
export type SheetLayout = {
  title: string; kind: ResourceKind; firstRow?: number; nameColumns?: string[]; urlColumns?: string[]
  auxiliaryUrlColumns?: string[]; noteColumns?: string[]; stackHint?: string; reason?: string
}
export type SourceLayout = { sheets: SheetLayout[]; deferredHosts?: string[]; separateWorkflowHosts?: string[] }
export type ResourceReference = { workbook: WorkbookReference; registryPath: string; displayedValue?: string; notes?: string }
export type Resource = {
  name: string; kind: ResourceKind; url?: string; stackHint?: string; references: ResourceReference[]
  status: 'prepared' | 'review' | 'deferred' | 'blocked'; reason: string
}
export type SheetAudit = { title: string; sheetId: number; status: 'processed' | 'skipped' | 'review' | 'unavailable'; rows: number; occurrences: number; reason: string }
export type CompanySourceCatalog = {
  version: 1; fileId: string; fileName: string; fetchedAt: string; registryPath: string
  entries: Resource[]; sheetAudit: SheetAudit[]; companyManifest: { sources: Source[] }
  summary: { resources: number; companySources: number; duplicateOccurrences: number; review: number; deferred: number; blocked: number }
  readyForFullCollection: boolean
}
