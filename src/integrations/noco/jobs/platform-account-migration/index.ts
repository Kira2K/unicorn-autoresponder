const { createNocoClient } = require('../../core/client.ts') as {
  createNocoClient(): any
}
const { describeError } = require('../../core/errors.ts') as {
  describeError(error: any): string
}
const { parseJobArgs } = require('../../core/job.ts') as {
  parseJobArgs(args?: string[]): { apply: boolean; dryRun: boolean; test: boolean; mode: string }
}
const { linkRecords } = require('../../core/relations.ts') as {
  linkRecords(
    client: any,
    sourceTable: any,
    fieldId: string,
    sourceRecordId: number,
    relatedIds: number[]
  ): Promise<{ ok: boolean; linked?: number; error?: string }>
}
const { createReportDir, writeJson, writeText } = require('../../core/reports.ts') as {
  createReportDir(jobName: string): string
  writeJson(dir: string, fileName: string, data: unknown): void
  writeText(dir: string, fileName: string, content: string): void
}
const { TABLES } = require('../../core/schema.ts') as {
  TABLES: Record<string, { id: string; title: string }>
}
const {
  fetchSheetValues,
  getRequiredSheet
} = require('../../integrations/google-sheets.ts') as {
  fetchSheetValues(sheetNames: string[]): Promise<{
    sheets: Array<{ title: string; values: string[][] }>
  }>
  getRequiredSheet(
    sheets: Array<{ title: string; values: string[][] }>,
    title: string
  ): string[][]
}
const {
  buildPlatformAccountReport,
  renderManualReview,
  runTests,
  summarize
} = require('./logic.ts') as {
  buildPlatformAccountReport(input: any): any
  renderManualReview(report: any): string
  runTests(): void
  summarize(report: any): Record<string, unknown>
}

const JOB_NAME = 'nocodb-platform-account-migration'
const PERSONAL_DATA_SHEET_NAME = 'ПЕРС ДАННЫЕ'
const PLATFORM_ACCOUNT_CLIENT_RELATION = 'rel_platformAccounts_client'
const PLATFORM_ACCOUNT_PLATFORM_RELATION = 'rel_platformAccounts_platform'

async function loadLiveData(client = createNocoClient()): Promise<{
  personalDataValues: string[][]
  clients: any[]
  platformAccounts: any[]
  platforms: any[]
}> {
  const [sheetState, clients, platformAccounts, platforms] = await Promise.all([
    fetchSheetValues([PERSONAL_DATA_SHEET_NAME]),
    client.fetchRecords(TABLES.clients.id),
    client.fetchRecords(TABLES.platformAccounts.id),
    client.fetchRecords(TABLES.platforms.id)
  ])

  return {
    personalDataValues: getRequiredSheet(sheetState.sheets, PERSONAL_DATA_SHEET_NAME),
    clients,
    platformAccounts,
    platforms
  }
}

function writeReports(dir: string, report: any): void {
  writeJson(dir, 'summary.json', summarize(report))
  writeJson(dir, 'source-platform-accounts.json', report.sourcePlatformAccounts)
  writeJson(dir, 'platform-create-plans.json', report.platformCreatePlans)
  writeJson(dir, 'create-plans.json', report.createPlans)
  writeJson(dir, 'patch-blank-plans.json', report.patchBlankPlans)
  writeJson(dir, 'conflicts.json', report.conflicts)
  writeJson(dir, 'duplicates.json', report.duplicates)
  writeJson(dir, 'incomplete-source.json', report.incompleteSource)
  writeJson(dir, 'unmatched-clients.json', report.unmatchedClients)
  writeText(dir, 'manual-review.md', renderManualReview(report))
}

function extractCreatedRecordId(result: unknown): number | null {
  const value = Array.isArray(result) ? result[0] : result
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const data = Array.isArray(record.data) ? record.data[0] : record.data
  const candidate = data && typeof data === 'object'
    ? data as Record<string, unknown>
    : record
  const id = Number(candidate.Id ?? candidate.id)
  return Number.isFinite(id) && id > 0 ? id : null
}

function relationFieldId(meta: any, title: string): string | undefined {
  return (meta.columns ?? []).find((column: any) => column.title === title)?.id
}

async function linkAccountRelations(
  client: any,
  accountId: number,
  clientId: number,
  platformId?: number
): Promise<Array<Record<string, unknown>>> {
  const meta = await client.fetchTableMeta(TABLES.platformAccounts.id)
  const results: Array<Record<string, unknown>> = []
  const clientRelationId = relationFieldId(meta, PLATFORM_ACCOUNT_CLIENT_RELATION)
  const platformRelationId = relationFieldId(meta, PLATFORM_ACCOUNT_PLATFORM_RELATION)

  if (clientRelationId) {
    results.push({
      relation: PLATFORM_ACCOUNT_CLIENT_RELATION,
      result: await linkRecords(
        client,
        TABLES.platformAccounts,
        clientRelationId,
        accountId,
        [clientId]
      )
    })
  } else {
    results.push({
      relation: PLATFORM_ACCOUNT_CLIENT_RELATION,
      result: { ok: false, error: 'relation field not found' }
    })
  }

  if (platformId && platformRelationId) {
    results.push({
      relation: PLATFORM_ACCOUNT_PLATFORM_RELATION,
      result: await linkRecords(
        client,
        TABLES.platformAccounts,
        platformRelationId,
        accountId,
        [platformId]
      )
    })
  } else if (platformId) {
    results.push({
      relation: PLATFORM_ACCOUNT_PLATFORM_RELATION,
      result: { ok: false, error: 'relation field not found' }
    })
  }

  return results
}

async function applyReport(report: any, client = createNocoClient()): Promise<Record<string, unknown>> {
  const createdPlatforms: Array<Record<string, unknown>> = []
  const failedPlatformCreates: Array<Record<string, unknown>> = []
  const createdAccounts: Array<Record<string, unknown>> = []
  const failedAccountCreates: Array<Record<string, unknown>> = []
  const patchedAccounts: Array<Record<string, unknown>> = []
  const failedPatches: Array<Record<string, unknown>> = []

  for (const plan of report.platformCreatePlans) {
    try {
      const result = await client.createRecord(TABLES.platforms.id, plan.record)
      createdPlatforms.push({
        plan,
        recordId: extractCreatedRecordId(result)
      })
      await client.wait(120)
    } catch (error: any) {
      failedPlatformCreates.push({ plan, error: describeError(error) })
    }
  }

  const platformRows = await client.fetchRecords(TABLES.platforms.id)
  const platformIds = new Map<string, number>()
  for (const row of platformRows) {
    for (const key of [row.label, row.platform, row.name]) {
      const value = String(key ?? '').trim().toLowerCase()
      if (value && !platformIds.has(value)) {
        platformIds.set(value, Number(row.Id))
      }
    }
  }

  for (const plan of report.createPlans) {
    const platformRecordId = platformIds.get(String(plan.platform).toLowerCase()) ?? plan.platformRecordId
    const record = {
      ...plan.record,
      ...(platformRecordId ? { platforms_id: platformRecordId } : {})
    }
    try {
      const result = await client.createRecord(TABLES.platformAccounts.id, record)
      const accountId = extractCreatedRecordId(result)
      const relationResults = accountId
        ? await linkAccountRelations(client, accountId, plan.clientId, platformRecordId)
        : []
      createdAccounts.push({
        plan,
        accountId,
        relationResults
      })
      await client.wait(120)
    } catch (error: any) {
      failedAccountCreates.push({ plan, error: describeError(error) })
    }
  }

  for (const plan of report.patchBlankPlans) {
    try {
      await client.patchRecord(TABLES.platformAccounts.id, plan.accountId, plan.patch)
      patchedAccounts.push(plan)
      await client.wait(120)
    } catch (error: any) {
      failedPatches.push({ plan, error: describeError(error) })
    }
  }

  return {
    createdPlatforms,
    failedPlatformCreates,
    createdAccounts,
    failedAccountCreates,
    patchedAccounts,
    failedPatches
  }
}

async function main(): Promise<void> {
  const args = parseJobArgs()

  if (args.test) {
    runTests()
    console.log('noco:platform-accounts tests passed')
    return
  }

  const client = createNocoClient()
  const dir = createReportDir(JOB_NAME)
  const liveData = await loadLiveData(client)
  const report = buildPlatformAccountReport(liveData)
  writeReports(dir, report)

  if (!args.apply) {
    writeJson(dir, 'apply-result.json', { mode: 'dry-run', applied: false })
    console.log(`NocoDB platform account migration dry-run written to ${dir}`)
    console.log(JSON.stringify(summarize(report), null, 2))
    return
  }

  const applyResult: any = await applyReport(report, client)
  writeJson(dir, 'apply-result.json', applyResult)
  const after = await loadLiveData(client)
  const postApplyReport = buildPlatformAccountReport(after)
  writeJson(dir, 'post-apply-summary.json', summarize(postApplyReport))

  console.log(`NocoDB platform account migration apply written to ${dir}`)
  console.log(JSON.stringify({ before: summarize(report), after: summarize(postApplyReport) }, null, 2))

  if (
    applyResult.failedPlatformCreates.length ||
    applyResult.failedAccountCreates.length ||
    applyResult.failedPatches.length
  ) {
    process.exitCode = 1
  }
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(describeError(error))
    process.exit(1)
  })
}

module.exports = {
  applyReport,
  loadLiveData,
  writeReports
}
