const { getDolphinProfile } = require('../../dolphin/profiles.ts') as {
  getDolphinProfile(profileId: number): Promise<any>
}
const { createNocoClient } = require('../core/client.ts') as {
  createNocoClient(options?: any): any
}
const { describeError } = require('../core/errors.ts') as {
  describeError(error: any): string
}
const { parseJobArgs } = require('../core/job.ts') as {
  parseJobArgs(args?: string[]): {
    apply: boolean
    dryRun: boolean
    test: boolean
    mode: 'dry-run' | 'apply' | 'test'
  }
}
const { createReportDir, writeJson, writeText } = require('../core/reports.ts') as {
  createReportDir(jobName: string): string
  writeJson(dir: string, fileName: string, data: unknown): void
  writeText(dir: string, fileName: string, content: string): void
}
const { TABLES } = require('../core/schema.ts') as {
  TABLES: Record<string, { id: string; title: string }>
}
const {
  buildMarketBindingReport,
  collectRequiredDolphinProfileIds,
  normalizeProfileId,
  renderManualReview,
  runTests
} = require('./logic.ts') as {
  buildMarketBindingReport(input: {
    state: NocoState
    dolphinProfilesById: Record<string, DolphinProfileDetail>
    checkedAt?: string
  }): ValidationReport
  collectRequiredDolphinProfileIds(state: NocoState): string[]
  normalizeProfileId(value: unknown): string
  renderManualReview(report: ValidationReport): string
  runTests(): void
}

type NocoRecord = Record<string, unknown> & { Id: number }

type NocoState = {
  clients: NocoRecord[]
  autoresponseRows: NocoRecord[]
  profiles: NocoRecord[]
  stacks: NocoRecord[]
}

type DolphinProfileDetail = {
  id: string
  name?: string
  tags?: string[]
  proxy?: {
    id?: string | number
    name?: string
    host?: string
  } | null
  error?: string
}

type ValidationRow = {
  status: 'ok' | 'warning' | 'error'
  clientId: number | null
  clientName: string
  market: 'Ru' | 'En'
  dolphinProfileId?: string
  issues: Array<{ severity: 'warning' | 'error'; code: string; message: string }>
}

type ValidationReport = {
  checkedAt: string
  totalTargets: number
  totalRows: number
  summary: Record<string, unknown>
  rows: ValidationRow[]
}

const JOB_NAME = 'nocodb-dolphin-market-binding'

function toDolphinProfileDetail(profileId: string, profile: any): DolphinProfileDetail {
  const proxy = profile?.proxy
    ? {
        id: profile.proxy.id,
        name: String(profile.proxy.name ?? '').trim(),
        host: String(profile.proxy.host ?? '').trim()
      }
    : null

  return {
    id: normalizeProfileId(profile?.id ?? profileId),
    name: String(profile?.name ?? '').trim(),
    tags: Array.isArray(profile?.tags) ? profile.tags.map((tag: unknown) => String(tag)) : [],
    proxy
  }
}

async function loadNocoState(client = createNocoClient()): Promise<NocoState> {
  const [clients, autoresponseRows, profiles, stacks] = await Promise.all([
    client.fetchRecords(TABLES.clients.id, 1000),
    client.fetchRecords(TABLES.hhAutoresponses.id, 1000),
    client.fetchRecords(TABLES.dolphinProfiles.id, 1000),
    client.fetchRecords(TABLES.stacks.id, 1000)
  ])

  return { clients, autoresponseRows, profiles, stacks }
}

async function fetchRequiredDolphinProfiles(
  state: NocoState,
  client = createNocoClient()
): Promise<Record<string, DolphinProfileDetail>> {
  const details: Record<string, DolphinProfileDetail> = {}
  const profileIds = collectRequiredDolphinProfileIds(state)

  for (const profileId of profileIds) {
    try {
      details[profileId] = toDolphinProfileDetail(profileId, await getDolphinProfile(Number(profileId)))
    } catch (error: any) {
      details[profileId] = {
        id: profileId,
        error: describeError(error)
      }
    }
    await client.wait(120)
  }

  return details
}

function writeReport(dir: string, report: ValidationReport): void {
  const errors = report.rows.filter(row => row.status === 'error')
  const warnings = report.rows.filter(row => row.status === 'warning')
  writeJson(dir, 'summary.json', report.summary)
  writeJson(dir, 'rows.json', report.rows)
  writeJson(dir, 'errors.json', errors)
  writeJson(dir, 'warnings.json', warnings)
  writeText(dir, 'manual-review.md', renderManualReview(report))
  writeJson(dir, 'apply-result.json', {
    mode: 'dry-run',
    applied: false,
    reason: 'read_only_validator'
  })
}

async function runDryRun(): Promise<{ dir: string; report: ValidationReport }> {
  const client = createNocoClient()
  const dir = createReportDir(JOB_NAME)
  const state = await loadNocoState(client)
  const dolphinProfilesById = await fetchRequiredDolphinProfiles(state, client)
  const report = buildMarketBindingReport({ state, dolphinProfilesById })
  writeReport(dir, report)
  return { dir, report }
}

async function main(): Promise<void> {
  const args = parseJobArgs()

  if (args.test) {
    runTests()
    console.log('noco:dolphin-market-binding tests passed')
    return
  }

  if (args.apply) {
    throw new Error('noco:dolphin-market-binding is read-only. Use --dry-run.')
  }

  const { dir, report } = await runDryRun()
  console.log(`Dolphin market binding dry-run written to ${dir}`)
  console.log(JSON.stringify(report.summary, null, 2))
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(describeError(error))
    process.exitCode = 1
  })
}

module.exports = {
  fetchRequiredDolphinProfiles,
  loadNocoState,
  runDryRun,
  toDolphinProfileDetail,
  writeReport
}
