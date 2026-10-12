import { test } from 'node:test'
import assert from 'node:assert/strict'
import { processCompanySources } from '../company_sources/index.ts'
import type { WorkbookSnapshot, SourceLayout } from '../company_sources/types.ts'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readSources } from '../vacancy_collection/sources.ts'

const text = (formattedValue: string, hyperlink?: string) => ({ formattedValue, ...(hyperlink ? { hyperlink } : {}) })
const layout: SourceLayout = { sheets: [
  { title: 'Companies', kind: 'company', firstRow: 3, nameColumns: ['B'], urlColumns: ['C', 'B'], auxiliaryUrlColumns: ['D'], noteColumns: ['E'] },
  { title: 'Jobs', kind: 'vacancy_seed', firstRow: 2, stackHint: 'Python' },
  { title: 'Channels', kind: 'telegram', firstRow: 2, urlColumns: ['B'] },
  { title: 'Criteria', kind: 'reference', reason: 'DB policies remain authoritative' }
], deferredHosts: ['himalayas.app'] }
function snapshot(): WorkbookSnapshot {
  return { version: 1, registryPath: 'company_sources/sources.md', fetchedAt: '2026-09-25T00:00:00Z', metadata: { id: 'file-id', title: 'Resources', mime_type: 'application/vnd.google-apps.spreadsheet' }, spreadsheet: { spreadsheetId: 'file-id', sheets: [
    { properties: { title: 'Companies', sheetId: 0 }, data: [{ startRow: 2, startColumn: 1, rowData: [
      { values: [text('One'), text('Ссылка', 'https://one.test/jobs'), text('LinkedIn', 'https://www.linkedin.com/company/one/')] },
      { values: [text('One again'), { textFormatRuns: [{ format: { link: { uri: 'https://one.test/jobs' } } }] }] },
      { values: [text('Name link', 'https://two.test/jobs'), text('Ссылка')] },
      { values: [text('Missing'), text('Ссылка'), text('LinkedIn', 'https://lnkd.in/blocked')] },
      { values: [text('Paused'), text('Link', 'https://himalayas.app/jobs')] },
      { values: [text('Relative formula'), { userEnteredValue: { formulaValue: '=HYPERLINK(C2; "Link")' } }] },
      { values: [text('Formula'), { userEnteredValue: { formulaValue: '=HYPERLINK("https://three.test/jobs"; "Link")' } }] },
      { values: [text('Telegram instead of company'), text('https://t.me/jobs_channel')] }
    ] }] },
    { properties: { title: 'Jobs', sheetId: 1 }, data: [{ startRow: 1, startColumn: 1, rowData: [
      { values: [text('https://jobs.test/tруv/role', 'https://jobs.test/truv/role'), text('Student name'), text('+')] }
    ] }] },
    { properties: { title: 'Channels', sheetId: 2 }, data: [{ startRow: 1, startColumn: 1, rowData: [{ values: [text('t.me/jobs_channel')] }] }] },
    { properties: { title: 'Criteria', sheetId: 3 } },
    { properties: { title: 'Archive', sheetId: 4, hidden: true } }
  ] } }
}

test('source preparation extracts actual hyperlinks, merges duplicate provenance and never promotes unrelated tabs', () => {
  const result = processCompanySources(snapshot(), layout)
  assert.equal(result.companyManifest.sources.length, 3)
  const one = result.entries.find(e => e.url === 'https://one.test/jobs')!
  assert.equal(one.references.length, 2)
  assert.equal(one.references[0].workbook.careerCell, 'C3')
  assert.equal(one.references[1].workbook.careerCell, 'C4')
  assert.equal(result.companyManifest.sources.find(s => s.name === 'Name link')!.workbook!.careerCell, 'B5')
  assert.equal(result.entries.find(e => e.url === 'https://jobs.test/truv/role')!.status, 'review')
  assert.equal(result.entries.find(e => e.url === 'https://jobs.test/truv/role')!.stackHint, 'Python')
  assert.ok(!JSON.stringify(result).includes('Student name'))
  assert.equal(result.sheetAudit.find(s => s.title === 'Archive')!.status, 'skipped')
  assert.equal(result.sheetAudit.find(s => s.title === 'Criteria')!.status, 'skipped')
})

test('blocked, missing and deferred sources remain visible and never enter the company crawl manifest', () => {
  const result = processCompanySources(snapshot(), layout)
  assert.equal(result.entries.filter(e => e.status === 'blocked').length, 2)
  assert.equal(result.entries.find(e => e.name === 'Missing')!.reason, 'missing_url')
  assert.equal(result.entries.find(e => e.name === 'Relative formula')!.reason, 'missing_url')
  assert.equal(result.entries.find(e => e.name === 'Paused')!.reason, 'paused_source')
  const tg = result.entries.find(e => e.url === 'https://t.me/jobs_channel')!
  assert.equal(tg.kind, 'telegram'); assert.equal(tg.status, 'deferred'); assert.equal(tg.references.length, 2)
  assert.equal(result.companyManifest.sources.length, 3)
  assert.equal(result.readyForFullCollection, false)
})

test('unread or unconfigured tabs produce an explicit coverage gap and mismatched file IDs fail', () => {
  const input = snapshot()
  input.spreadsheet.sheets.push({ properties: { title: 'New sources', sheetId: 5 } })
  input.spreadsheet.sheets[0].data = undefined
  const result = processCompanySources(input, layout)
  assert.equal(result.sheetAudit.find(s => s.title === 'New sources')!.status, 'review')
  assert.equal(result.sheetAudit.find(s => s.title === 'Companies')!.status, 'unavailable')
  assert.equal(result.companyManifest.sources.length, 0)
  input.metadata.id = 'wrong-file'
  assert.throws(() => processCompanySources(input, layout), /source_file_identity_mismatch/)
})

test('the standalone CLI produces a replayable collector manifest and preserves blocked/review queues', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'external-source-test-'))
  try {
    const input = join(directory, 'snapshot.json'), config = join(directory, 'layout.json'), out = join(directory, 'out')
    await writeFile(input, JSON.stringify(snapshot())); await writeFile(config, JSON.stringify(layout))
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../cli.ts', import.meta.url)), 'sources', '--input', input, '--layout', config, '--out', out], { windowsHide: true })
    const manifest = await readSources({ path: join(out, 'companies.json') })
    assert.equal(manifest.length, 3)
    assert.equal(manifest[0].workbook!.careerCell, 'C3')
    assert.match(manifest[0].provenance!, /B4:C4/)
    assert.equal(JSON.parse(await readFile(join(out, 'blocked.json'), 'utf8')).length, 2)
    assert.ok(JSON.parse(await readFile(join(out, 'review.json'), 'utf8')).some((r: { reason: string }) => r.reason === 'missing_url'))
    assert.match(await readFile(join(out, 'report.md'), 'utf8'), /websites and vacancy availability have not been inspected/)
    assert.match(await readFile(join(out, 'sources.csv'), 'utf8'), /"company_cell","link_cell"/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
