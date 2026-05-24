const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { createNocoClient } = require('../core/client.ts') as {
  createNocoClient(options?: any): any
}
const { describeDetailedError, describeError } = require('../core/errors.ts') as {
  describeDetailedError(error: any): Record<string, unknown>
  describeError(error: any): string
}
const { parseJobArgs } = require('../core/job.ts') as {
  parseJobArgs(args?: string[]): { apply: boolean; dryRun: boolean; test: boolean; mode: string }
}
const { createReportDir, ensureDir, writeJson, writeText } = require('../core/reports.ts') as {
  createReportDir(jobName: string): string
  ensureDir(dir: string): void
  writeJson(dir: string, fileName: string, data: unknown): void
  writeText(dir: string, fileName: string, content: string): void
}

type BackupEndpoint = {
  key: string
  endpoint: string
  required: boolean
}

type TableSummary = {
  id: string
  title: string
  tableName: string
  records: number
  metaFile: string
  recordsFile: string
  recordsSha256: string
}

const JOB_NAME = 'nocodb-full-backup'
const RECORD_PAGE_LIMIT = 100

function safeFileName(value: unknown): string {
  const normalized = String(value ?? 'untitled')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'untitled'
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortKeys(item)])
    )
  }
  return value
}

function stableJsonLine(value: unknown): string {
  return `${JSON.stringify(sortKeys(value))}\n`
}

function hashFile(filePath: string): string {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

async function fetchTables(client: any): Promise<any[]> {
  const data = await client.request(
    'get',
    `/api/v2/meta/bases/${client.config.baseId}/tables`
  ) as { list?: any[]; data?: any[] }
  return data.list ?? data.data ?? []
}

function buildOptionalEndpoints(baseId: string): BackupEndpoint[] {
  return [
    { key: 'app-version', endpoint: '/api/v1/version', required: false },
    { key: 'health', endpoint: '/api/v1/health', required: false },
    { key: 'app-info', endpoint: '/api/v1/db/meta/nocodb/info', required: false },
    { key: 'aggregated-meta-info', endpoint: '/api/v1/aggregated-meta-info', required: false },
    { key: 'app-settings', endpoint: '/api/v1/app-settings', required: false },
    { key: 'org-users', endpoint: '/api/v1/users', required: false },
    { key: 'org-tokens', endpoint: '/api/v1/tokens', required: false },
    { key: 'plugins', endpoint: '/api/v1/db/meta/plugins', required: false },
    { key: 'projects-v1', endpoint: '/api/v1/db/meta/projects', required: false },
    { key: 'base-meta-v2', endpoint: `/api/v2/meta/bases/${baseId}`, required: false },
    { key: 'base-read-v1', endpoint: `/api/v1/db/meta/projects/${baseId}`, required: false },
    { key: 'base-info-v1', endpoint: `/api/v1/db/meta/projects/${baseId}/info`, required: false },
    { key: 'base-shared-v1', endpoint: `/api/v1/db/meta/projects/${baseId}/shared`, required: false },
    { key: 'base-visibility-rules-v1', endpoint: `/api/v1/db/meta/projects/${baseId}/visibility-rules`, required: false },
    { key: 'base-meta-diff-v1', endpoint: `/api/v1/db/meta/projects/${baseId}/meta-diff`, required: false },
    { key: 'base-audits-v1', endpoint: `/api/v1/db/meta/projects/${baseId}/audits`, required: false },
    { key: 'base-users-v1', endpoint: `/api/v1/db/meta/projects/${baseId}/users`, required: false },
    { key: 'base-api-tokens-v1', endpoint: `/api/v1/db/meta/projects/${baseId}/api-tokens`, required: false }
  ]
}

async function fetchOptionalEndpoint(client: any, endpoint: BackupEndpoint): Promise<Record<string, unknown>> {
  try {
    const data = await client.request('get', endpoint.endpoint)
    return {
      key: endpoint.key,
      endpoint: endpoint.endpoint,
      ok: true,
      file: `${safeFileName(endpoint.key)}.json`,
      data
    }
  } catch (error: any) {
    return {
      key: endpoint.key,
      endpoint: endpoint.endpoint,
      ok: false,
      error: describeDetailedError(error)
    }
  }
}

async function exportTableRecords(client: any, table: any, filePath: string): Promise<number> {
  let count = 0
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' })

  try {
    for (let offset = 0; ; offset += RECORD_PAGE_LIMIT) {
      const data = await client.request(
        'get',
        `/api/v2/tables/${table.id}/records?limit=${RECORD_PAGE_LIMIT}&offset=${offset}`
      ) as { list?: any[]; data?: any[]; pageInfo?: { isLastPage?: boolean } }
      const rows = data.list ?? data.data ?? []
      for (const row of rows) {
        stream.write(stableJsonLine(row))
        count += 1
      }

      if (data.pageInfo?.isLastPage === true || (!data.pageInfo && rows.length < RECORD_PAGE_LIMIT)) {
        break
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      stream.end(error => error ? reject(error) : resolve())
    })
  }

  return count
}

async function buildPlan(client: any): Promise<Record<string, unknown>> {
  const tables = await fetchTables(client)
  const endpoints = buildOptionalEndpoints(client.config.baseId)
  return {
    baseUrl: client.config.baseUrl,
    baseId: client.config.baseId,
    tables: tables.map(table => ({
      id: table.id,
      title: table.title,
      tableName: table.table_name
    })),
    optionalEndpoints: endpoints.map(endpoint => ({
      key: endpoint.key,
      endpoint: endpoint.endpoint,
      required: endpoint.required
    }))
  }
}

async function runDryRun(client: any, dir: string): Promise<void> {
  const plan = await buildPlan(client)
  writeJson(dir, 'backup-plan.json', plan)
  writeJson(dir, 'apply-result.json', {
    mode: 'dry-run',
    applied: false,
    note: 'Dry-run only lists tables and optional metadata endpoints; use --apply to export records.'
  })
  console.log(`NocoDB full backup dry-run written to ${dir}`)
  console.log(JSON.stringify({
    tables: (plan.tables as unknown[]).length,
    optionalEndpoints: (plan.optionalEndpoints as unknown[]).length
  }, null, 2))
}

async function runApply(client: any, dir: string): Promise<void> {
  const tables = await fetchTables(client)
  const tableMetaDir = path.join(dir, 'table-meta')
  const recordsDir = path.join(dir, 'records')
  const optionalDir = path.join(dir, 'optional-meta')
  ensureDir(tableMetaDir)
  ensureDir(recordsDir)
  ensureDir(optionalDir)

  const optionalEndpointResults = []
  const optionalEndpoints = [
    ...buildOptionalEndpoints(client.config.baseId),
    ...tables.map(table => ({
      key: `table-hooks-${safeFileName(table.title ?? table.table_name ?? table.id)}-${table.id}`,
      endpoint: `/api/v1/db/meta/tables/${table.id}/hooks`,
      required: false
    }))
  ]
  for (const endpoint of optionalEndpoints) {
    const result = await fetchOptionalEndpoint(client, endpoint)
    const { data, ...resultSummary } = result
    optionalEndpointResults.push(resultSummary)
    if (result.ok) {
      writeJson(optionalDir, String(result.file), data)
    }
    await client.wait(120)
  }

  const tableSummaries: TableSummary[] = []
  for (const table of tables) {
    const tableTitle = table.title ?? table.table_name ?? table.id
    const fileStem = `${safeFileName(tableTitle)}__${table.id}`
    const meta = await client.fetchTableMeta(table.id)
    const metaFile = path.join('table-meta', `${fileStem}.json`)
    const recordsFile = path.join('records', `${fileStem}.jsonl`)
    writeJson(dir, metaFile, meta)
    const records = await exportTableRecords(client, table, path.join(dir, recordsFile))
    tableSummaries.push({
      id: table.id,
      title: tableTitle,
      tableName: table.table_name ?? '',
      records,
      metaFile,
      recordsFile,
      recordsSha256: hashFile(path.join(dir, recordsFile))
    })
    await client.wait(120)
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    kind: 'nocodb-api-full-backup',
    baseUrl: client.config.baseUrl,
    baseId: client.config.baseId,
    notes: [
      'Read-only API backup of current visible NocoDB state.',
      'Deleted columns/records are not included unless NocoDB returns them through these APIs.',
      'Attachment binary files are not downloaded; record attachment metadata is preserved as returned by NocoDB.',
      'Optional permission/settings endpoints are captured only when this token can read them.'
    ],
    tables: tableSummaries,
    optionalEndpoints: optionalEndpointResults,
    totals: {
      tables: tableSummaries.length,
      records: tableSummaries.reduce((sum, table) => sum + table.records, 0),
      optionalEndpointsOk: optionalEndpointResults.filter(item => item.ok).length,
      optionalEndpointsFailed: optionalEndpointResults.filter(item => !item.ok).length
    }
  }

  writeJson(dir, 'base-tables.json', tables)
  writeJson(dir, 'manifest.json', manifest)
  writeJson(dir, 'checksums.json', Object.fromEntries(
    tableSummaries.map(table => [table.recordsFile, table.recordsSha256])
  ))
  writeJson(dir, 'apply-result.json', {
    mode: 'apply',
    applied: true,
    ...manifest.totals
  })
  writeText(dir, 'README.txt', [
    'NocoDB API full backup',
    '',
    'This directory contains table metadata, JSONL record exports, and optional NocoDB permission/settings metadata available to the current token.',
    'Treat it as sensitive: records and optional metadata may include personal data, tokens, settings, and connected-service configuration.',
    ''
  ].join('\n'))

  console.log(`NocoDB full backup written to ${dir}`)
  console.log(JSON.stringify(manifest.totals, null, 2))
}

async function run(apply: boolean): Promise<void> {
  const client = createNocoClient({ requestTimeoutMs: 120000 })
  const dir = createReportDir(JOB_NAME)
  if (apply) {
    await runApply(client, dir)
  } else {
    await runDryRun(client, dir)
  }
}

function runTests(): void {
  assert.equal(safeFileName('clients'), 'clients')
  assert.equal(safeFileName('bad/name:here'), 'bad_name_here')
  assert.equal(stableJsonLine({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}\n')
}

async function main(): Promise<void> {
  const args = parseJobArgs()
  if (args.test) {
    runTests()
    console.log('noco:full-backup tests passed')
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
  buildOptionalEndpoints,
  safeFileName,
  stableJsonLine
}
