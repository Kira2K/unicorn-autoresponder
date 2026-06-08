const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createNocoClient, isRetryableNocoError } = require('./client.ts') as {
  createNocoClient(options?: any): any
  isRetryableNocoError(error: any): boolean
}
const { parseJobArgs } = require('./job.ts') as {
  parseJobArgs(args?: string[]): { mode: string; apply: boolean; dryRun: boolean; test: boolean }
}
const {
  buildLinkPayloads,
  formatLinkedRecordLabel,
  formatLinkedRelationLabel,
  getLinkedRecord,
  getLinkedRecordId,
  getLinkedRecords,
  noMigrationRefsEnabled,
  uniqueRelatedIds
} = require('./relations.ts') as {
  buildLinkPayloads(relatedIds: number[]): unknown[]
  formatLinkedRecordLabel(record: Record<string, unknown> | null | undefined): string
  formatLinkedRelationLabel(value: unknown): string
  getLinkedRecord(value: unknown): Record<string, unknown> | null
  getLinkedRecordId(value: unknown): number | null
  getLinkedRecords(value: unknown): Array<Record<string, unknown>>
  noMigrationRefsEnabled(): boolean
  uniqueRelatedIds(relatedIds: number[]): number[]
}
const { createMockRequester, createTempDir } = require('./test-utils.ts') as {
  createMockRequester(responses: Array<unknown | Error>): { calls: any[]; requester: any }
  createTempDir(prefix?: string): string
}
const { writeJson, writeText } = require('./reports.ts') as {
  writeJson(dir: string, fileName: string, data: unknown): void
  writeText(dir: string, fileName: string, content: string): void
}
const { normalizeLookupText, slugify, uniqueValue } = require('./text.ts') as {
  normalizeLookupText(value: unknown): string
  slugify(value: unknown): string
  uniqueValue(baseValue: string, usedValues: Set<string>): string
}

function httpError(status: number, message: string): Error {
  const error: any = new Error(message)
  error.response = { status, data: { message } }
  return error
}

async function runTests(): Promise<void> {
  assert.deepEqual(parseJobArgs([]), {
    mode: 'dry-run',
    apply: false,
    dryRun: true,
    test: false
  })
  assert.equal(parseJobArgs(['--apply']).mode, 'apply')
  assert.equal(parseJobArgs(['--test']).mode, 'test')
  assert.throws(() => parseJobArgs(['--apply', '--dry-run']), /Use only one/)

  assert.equal(isRetryableNocoError(httpError(429, 'Too Many Requests')), true)
  assert.equal(isRetryableNocoError(httpError(400, 'Bad Request')), false)

  const paged = createMockRequester([
    { list: [{ Id: 1 }], pageInfo: { isLastPage: false } },
    { list: [{ Id: 2 }], pageInfo: { isLastPage: true } }
  ])
  const client = createNocoClient({ requester: paged.requester, retryDelaysMs: [0] })
  const records = await client.fetchRecords('table', 1)
  assert.deepEqual(records.map((record: any) => record.Id), [1, 2])
  assert.equal(paged.calls.length, 2)

  assert.deepEqual(uniqueRelatedIds([1, 1, 2, 0]), [1, 2])
  assert.deepEqual(buildLinkPayloads([1, 1, 2]), [
    [{ Id: 1 }, { Id: 2 }],
    { data: [{ Id: 1 }, { Id: 2 }] }
  ])
  assert.equal(getLinkedRecord({ Id: 5, name: 'one' })?.Id, 5)
  assert.equal(getLinkedRecord([{ Id: 6 }, { Id: 7 }])?.Id, 6)
  assert.equal(getLinkedRecord({ data: [{ Id: 8 }] })?.Id, 8)
  assert.deepEqual(getLinkedRecords(null), [])
  assert.equal(getLinkedRecordId([{ Id: 9 }]), 9)
  assert.equal(formatLinkedRecordLabel({ Id: 10, client_name: 'Кира' }), '10 Кира')
  assert.equal(formatLinkedRecordLabel({ Id: 11, company_name: 'Acme' }), '11 Acme')
  assert.equal(formatLinkedRecordLabel({ Id: 12 }), '12')
  assert.equal(formatLinkedRelationLabel([{ Id: 13, name: 'Frontend' }, { Id: 14, name: 'Python' }]), '13 Frontend, 14 Python')
  assert.equal(formatLinkedRelationLabel(null), '')

  const previousNoRef = process.env.NOCO_NO_MIGRATION_REFS
  process.env.NOCO_NO_MIGRATION_REFS = 'true'
  assert.equal(noMigrationRefsEnabled(), true)
  if (previousNoRef === undefined) {
    delete process.env.NOCO_NO_MIGRATION_REFS
  } else {
    process.env.NOCO_NO_MIGRATION_REFS = previousNoRef
  }

  assert.equal(normalizeLookupText(' Ёж  Тест '), 'еж тест')
  assert.equal(slugify('Сбер ГигаЧат'), 'sber_gigachat')
  const used = new Set(['item'])
  assert.equal(uniqueValue('item', used), 'item_2')

  const dir = createTempDir()
  writeJson(dir, 'data.json', { ok: true })
  writeText(dir, 'data.txt', 'hello')
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')).ok, true)
  assert.equal(fs.readFileSync(path.join(dir, 'data.txt'), 'utf8'), 'hello')
}

Promise.resolve()
  .then(runTests)
  .then(() => {
    console.log('noco:core tests passed')
  })
  .catch((error: any) => {
    console.error(error)
    process.exitCode = 1
  })
