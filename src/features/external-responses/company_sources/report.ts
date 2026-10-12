import type { CompanySourceCatalog } from './types.ts'

export function reportCompanySources(catalog: CompanySourceCatalog): { markdown: string; csv: string } {
  const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [ ['kind', 'name', 'url', 'status', 'reason', 'file_id', 'sheet', 'row', 'company_cell', 'link_cell'],
    ...catalog.entries.flatMap(entry => entry.references.map(ref => [entry.kind, entry.name, entry.url, entry.status, entry.reason,
      ref.workbook.fileId, ref.workbook.sheet, ref.workbook.row, ref.workbook.companyCell, ref.workbook.careerCell]))
  ].map(row => row.map(cell).join(',')).join('\n')
  const escape = (s: string) => s.replaceAll('|', '\\|').replace(/\r?\n/g, ' ')
  const markdown = [ '# Company source preparation', '', `File: ${catalog.fileName} (${catalog.fileId})`, `Read: ${catalog.fetchedAt}`, '',
    'This report verifies source-file access and parses links. Company websites and vacancy availability have not been inspected.', '',
    `Prepared company URLs: ${catalog.summary.companySources}. Unique resources: ${catalog.summary.resources}. Duplicate occurrences merged: ${catalog.summary.duplicateOccurrences}.`,
    `Review: ${catalog.summary.review}. Deferred: ${catalog.summary.deferred}. Blocked: ${catalog.summary.blocked}.`, '',
    'Duplicates merge URLs, retaining every sheet/row/cell reference. They are not application-history records.', '',
    '| Sheet | Read/processing status | Source rows | Link/issue occurrences | Reason |', '|---|---|---:|---:|---|',
    ...catalog.sheetAudit.map(s => `| ${escape(s.title)} | ${s.status} | ${s.rows} | ${s.occurrences} | ${escape(s.reason)} |`), '',
    'The company manifest contains prepared website sources only. Resolve missing/invalid company URLs and explicitly review deferred/excluded sources before declaring a complete campaign scope. Historical vacancy seeds require live refresh and employer-listing resolution. Aggregate websites and Telegram need their own adapters.', '',
    'Worksheet stack labels and criteria are reference material; classification uses only existing populated DB stacks and their current descriptions. Student application marks are not imported as success evidence. LinkedIn is never opened.', ''
  ].join('\n')
  return { markdown, csv }
}
