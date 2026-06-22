const { requestDolphinCloudApi } = require('../../dolphin/cloud-api.ts') as {
  requestDolphinCloudApi<T>(
    endpointPath: string,
    options?: {
      method?: 'GET' | 'PATCH' | 'POST' | 'DELETE' | 'PUT'
      query?: Record<string, string | number | boolean | undefined>
      body?: unknown
    }
  ): Promise<T>
}
const { createNocoClient } = require('../core/client.ts') as {
  createNocoClient(options?: any): any
}
const { TABLES } = require('../core/schema.ts') as {
  TABLES: Record<string, { key: string; id: string; title: string }>
}
const { describeError } = require('../core/errors.ts') as {
  describeError(error: any): string
}
const { parseJobArgs } = require('../core/job.ts') as {
  parseJobArgs(args?: string[]): { apply: boolean; dryRun: boolean; test: boolean; mode: 'dry-run' | 'apply' | 'test' }
}
const { createReportDir, writeJson, writeText } = require('../core/reports.ts') as {
  createReportDir(jobName: string): string
  writeJson(dir: string, fileName: string, data: unknown): void
  writeText(dir: string, fileName: string, content: string): void
}
const {
  buildTagCleanupReport,
  runTests
} = require('./logic.ts') as {
  buildTagCleanupReport(input: {
    profiles: DolphinProfileTagSnapshot[]
    nocoProfiles: Array<Record<string, unknown> & { Id: number }>
    clients: Array<Record<string, unknown> & { Id: number }>
    checkedAt?: string
  }): TagCleanupReport
  runTests(): void
}

type DolphinPaginatedResponse<T> = {
  current_page?: number
  last_page?: number
  total?: number
  data?: T[]
}

type DolphinBrowserProfile = {
  id?: string | number
  name?: string
  tags?: string[]
}

type DolphinProfileTagSnapshot = {
  id: string
  name: string
  tags: string[]
}

type TagCleanupAction = {
  profileId: string
  profileName: string
  status: 'already_clean' | 'will_update' | 'skipped'
  reason: string
  beforeTags: string[]
  afterTags: string[]
}

type TagCleanupReport = {
  checkedAt: string
  totalProfiles: number
  actions: TagCleanupAction[]
  summary: Record<string, number>
}

const JOB_NAME = 'dolphin-tag-cleanup'

function toTagSnapshot(profile: DolphinBrowserProfile): DolphinProfileTagSnapshot | null {
  const id = String(profile.id ?? '').trim()
  if (!id) return null

  return {
    id,
    name: String(profile.name ?? '').trim(),
    tags: Array.isArray(profile.tags) ? profile.tags : []
  }
}

async function fetchAllDolphinProfiles(): Promise<DolphinProfileTagSnapshot[]> {
  const limit = 100
  const profiles: DolphinProfileTagSnapshot[] = []
  let page = 1
  let total = Number.POSITIVE_INFINITY

  while (profiles.length < total) {
    const response = await requestDolphinCloudApi<DolphinPaginatedResponse<DolphinBrowserProfile>>(
      '/browser_profiles',
      {
        query: { limit, page }
      }
    )
    const data = response.data ?? []

    profiles.push(...data.map(toTagSnapshot).filter((profile): profile is DolphinProfileTagSnapshot => Boolean(profile)))
    total = response.total ?? profiles.length

    if (!data.length || page >= (response.last_page ?? page)) {
      break
    }

    page += 1
  }

  return await Promise.all(profiles.map(fetchDolphinProfileDetails))
}

async function fetchDolphinProfileDetails(
  profile: DolphinProfileTagSnapshot
): Promise<DolphinProfileTagSnapshot> {
  const response = await requestDolphinCloudApi<{ data?: DolphinBrowserProfile }>(
    `/browser_profiles/${profile.id}`
  )
  return toTagSnapshot(response.data ?? {}) ?? profile
}

async function updateDolphinProfileTags(profileId: string, tags: string[]): Promise<void> {
  await requestDolphinCloudApi(`/browser_profiles/${profileId}`, {
    method: 'PATCH',
    body: { tags }
  })
}

function renderManualReview(report: TagCleanupReport, mode: string): string {
  const lines = [
    '# Dolphin Tag Cleanup',
    '',
    `Mode: ${mode}`,
    `Checked at: ${report.checkedAt}`,
    `Profiles scanned: ${report.totalProfiles}`,
    '',
    '## Summary',
    '',
    ...Object.entries(report.summary).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Planned Updates',
    ''
  ]

  for (const action of report.actions.filter(item => item.status === 'will_update')) {
    lines.push(
      `- ${action.profileId} ${action.profileName}`,
      `  - before: ${action.beforeTags.join(' | ') || '(none)'}`,
      `  - after: ${action.afterTags.join(' | ') || '(none)'}`
    )
  }

  lines.push('', '## Skipped', '')
  for (const action of report.actions.filter(item => item.status === 'skipped')) {
    lines.push(
      `- ${action.profileId} ${action.profileName}: ${action.reason}`,
      `  - tags: ${action.beforeTags.join(' | ') || '(none)'}`
    )
  }

  return `${lines.join('\n')}\n`
}

async function loadReport(client = createNocoClient()): Promise<TagCleanupReport> {
  const [profiles, nocoProfiles, clients] = await Promise.all([
    fetchAllDolphinProfiles(),
    client.fetchRecords(TABLES.dolphinProfiles.id, 1000),
    client.fetchRecords(TABLES.clients.id, 1000)
  ])

  return buildTagCleanupReport({ profiles, nocoProfiles, clients })
}

async function applyTagUpdates(report: TagCleanupReport): Promise<Record<string, unknown>> {
  const updates = report.actions.filter(action => action.status === 'will_update')
  const results = []

  for (const action of updates) {
    try {
      await updateDolphinProfileTags(action.profileId, action.afterTags)
      results.push({
        ok: true,
        profileId: action.profileId,
        profileName: action.profileName,
        beforeTags: action.beforeTags,
        afterTags: action.afterTags
      })
    } catch (error: unknown) {
      results.push({
        ok: false,
        profileId: action.profileId,
        profileName: action.profileName,
        error: describeError(error)
      })
    }
  }

  return {
    attempted: updates.length,
    updated: results.filter(item => item.ok).length,
    failed: results.filter(item => !item.ok).length,
    results
  }
}

async function main(): Promise<void> {
  const args = parseJobArgs()

  if (args.test) {
    runTests()
    console.log('noco:dolphin-tag-cleanup tests passed')
    return
  }

  const dir = createReportDir(JOB_NAME)
  const report = await loadReport()
  writeJson(dir, 'summary.json', report.summary)
  writeJson(dir, 'actions.json', report.actions)
  writeJson(dir, 'planned-updates.json', report.actions.filter(action => action.status === 'will_update'))
  writeJson(dir, 'skipped.json', report.actions.filter(action => action.status === 'skipped'))
  writeText(dir, 'manual-review.md', renderManualReview(report, args.mode))

  if (args.apply) {
    const applyResult = await applyTagUpdates(report)
    writeJson(dir, 'apply-result.json', applyResult)
    console.log(`Dolphin tag cleanup apply written to ${dir}`)
    console.log(JSON.stringify({ summary: report.summary, applyResult }, null, 2))
    if (Number(applyResult.failed ?? 0) > 0) {
      process.exitCode = 1
    }
    return
  }

  writeJson(dir, 'apply-result.json', { mode: 'dry-run', applied: false })
  console.log(`Dolphin tag cleanup dry-run written to ${dir}`)
  console.log(JSON.stringify(report.summary, null, 2))
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(describeError(error))
    process.exitCode = 1
  })
}

module.exports = {
  applyTagUpdates,
  fetchAllDolphinProfiles,
  fetchDolphinProfileDetails,
  loadReport,
  renderManualReview,
  updateDolphinProfileTags
}
