const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { describeError } = require('../core/errors.ts') as {
  describeError(error: any): string
}
const { parseJobArgs } = require('../core/job.ts') as {
  parseJobArgs(args?: string[]): { apply: boolean; dryRun: boolean; test: boolean; mode: string }
}
const { createReportDir, writeJson, writeText } = require('../core/reports.ts') as {
  createReportDir(jobName: string): string
  writeJson(dir: string, fileName: string, data: unknown): void
  writeText(dir: string, fileName: string, content: string): void
}

type HealthCheck = {
  key: string
  script: string
  logName: string
  summaryFile: string
}

const JOB_NAME = 'nocodb-post-migration-health'
const BASELINE_BACKUP_PATH = 'logs/nocodb-full-backup/2026-06-01T00-10-50-409Z'

const HEALTH_CHECKS: HealthCheck[] = [
  { key: 'relations', script: 'noco:relations:dry-run', logName: 'nocodb-relations', summaryFile: 'summary.json' },
  { key: 'dolphin', script: 'noco:dolphin-profile-audit:dry-run', logName: 'nocodb-dolphin-profile-audit', summaryFile: 'summary.json' },
  { key: 'clientStatus', script: 'noco:client-status:dry-run', logName: 'nocodb-client-status', summaryFile: 'summary.json' },
  { key: 'stopCompanies', script: 'noco:stop-companies:dry-run', logName: 'nocodb-stop-companies', summaryFile: 'summary.json' },
  { key: 'platformAccounts', script: 'noco:platform-accounts:dry-run', logName: 'nocodb-platform-account-migration', summaryFile: 'summary.json' },
  { key: 'syncMarkets', script: 'noco:sync-markets:dry-run', logName: 'nocodb-sync-markets', summaryFile: 'summary.json' },
  { key: 'syncMentors', script: 'noco:sync-mentors:dry-run', logName: 'nocodb-sync-mentors', summaryFile: 'summary.json' },
  { key: 'refReadiness', script: 'noco:ref-drop-readiness:dry-run', logName: 'nocodb-ref-drop-readiness', summaryFile: 'summary.json' },
  { key: 'cleanupAudit', script: 'noco:cleanup-audit:dry-run', logName: 'nocodb-cleanup-audit', summaryFile: 'summary.json' }
]

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readLatestReportDir(logName: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'logs', logName, 'latest.txt'), 'utf8').trim()
}

function runNpmScript(script: string): { exitCode: number; stdout: string; stderr: string } {
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run ${script}`]
    : ['run', script]
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NOCO_NO_MIGRATION_REFS: 'true'
    },
    encoding: 'utf8',
    shell: false
  })
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: `${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`
  }
}

function reportDirFromOutput(output: string, logName: string): string {
  const escapedLogName = logName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`([A-Z]:\\\\[^\\r\\n]*logs\\\\${escapedLogName}\\\\[^\\r\\n]+|/[^\\r\\n]*logs/${escapedLogName}/[^\\r\\n]+)`)
  const match = output.match(regex)
  return match?.[1]?.trim() ?? ''
}

function validateSummary(key: string, summary: any): string[] {
  const failures: string[] = []
  const anyNonZero = (record: Record<string, unknown> | undefined): boolean =>
    Object.values(record ?? {}).some(value => Number(value) !== 0)

  if (key === 'relations') {
    if (anyNonZero(summary.unsafeCounts)) failures.push('relation unsafe counts are not zero')
  }
  if (key === 'dolphin') {
    if (Number(summary.profileExistsNotBound ?? 0) !== 0) failures.push('Dolphin profiles exist but are not bound')
    if (Number(summary.nocoProfileMissingInDolphin ?? 0) !== 0) failures.push('Noco profile rows are missing in Dolphin')
    if (Number(summary.conflictsAndDuplicates ?? 0) !== 0) failures.push('Dolphin conflicts/duplicates found')
  }
  if (key === 'clientStatus') {
    return failures
  }
  if (key === 'stopCompanies') {
    for (const field of [
      'companyCreatePlans',
      'restrictionCompanyLinkPlans',
      'missingClientRelationReview',
      'ambiguousCompanyReview',
      'duplicateCompanyNames'
    ]) {
      if (Number(summary[field] ?? 0) !== 0) failures.push(`stop-company ${field} is not zero`)
    }
  }
  if (key === 'platformAccounts') {
    for (const field of ['platformCreatePlans', 'createPlans', 'patchBlankPlans']) {
      if (Number(summary[field] ?? 0) !== 0) failures.push(`platform-account ${field} is not zero`)
    }
  }
  if (key === 'syncMarkets') {
    for (const field of ['patches', 'links', 'unknown']) {
      if (Number(summary[field] ?? 0) !== 0) failures.push(`sync-markets ${field} is not zero`)
    }
  }
  if (key === 'syncMentors') {
    if (Array.isArray(summary.missingStacks) && summary.missingStacks.length > 0) {
      failures.push('mentor sync has missing stacks')
    }
  }
  if (key === 'refReadiness') {
    if (Number(summary.readyNativeRelations ?? 0) !== Number(summary.expectedNativeRelations ?? 0)) {
      failures.push('not all native relations are ready')
    }
    if (Number(summary.blockedNativeRelations ?? 0) !== 0) failures.push('native relation blockers found')
    if (Number(summary.codeUsageBlockedColumns ?? 0) !== 0) failures.push('operational ref usage blockers found')
    if (Array.isArray(summary.blockers) && summary.blockers.length > 0) failures.push('readiness blockers found')
  }
  if (key === 'cleanupAudit') {
    const categories = Object.keys(summary.byCategory ?? {})
    if (categories.some(category => category !== 'keep')) {
      failures.push('cleanup audit has non-keep categories')
    }
  }
  return failures
}

function renderMarkdown(report: Record<string, any>): string {
  const lines = [
    '# Post-Migration Noco Health',
    '',
    `Baseline backup: ${report.baselineBackupPath}`,
    '',
    `Overall status: ${report.summary.ok ? 'ok' : 'failed'}`,
    '',
    '| Check | Exit | Failures | Report |',
    '|---|---:|---|---|'
  ]
  for (const check of report.checks) {
    lines.push(`| ${check.key} | ${check.exitCode} | ${check.failures.length ? check.failures.join('; ') : 'none'} | ${check.reportDir} |`)
  }
  lines.push(
    '',
    'Notes:',
    '- Clients without Dolphin profiles are intentional cost saving, not a health failure.',
    '- Client-status sheet mismatches are advisory only; Noco is the current status source of truth.',
    '- Mentor unmatched clients are non-blocking audit notes unless they are explicitly onboarded or ignored later.'
  )
  return `${lines.join('\n')}\n`
}

function buildFixtureReport(summaries: Record<string, unknown>): Record<string, unknown> {
  const checks = HEALTH_CHECKS.map(check => {
    const summary = (summaries as any)[check.key] ?? {}
    const failures = validateSummary(check.key, summary)
    return {
      key: check.key,
      script: check.script,
      exitCode: 0,
      reportDir: 'fixture',
      failures,
      summary
    }
  })
  return {
    baselineBackupPath: BASELINE_BACKUP_PATH,
    summary: {
      ok: checks.every(check => check.failures.length === 0),
      checks: checks.length,
      failedChecks: checks.filter(check => check.failures.length > 0).length
    },
    checks
  }
}

async function run(): Promise<void> {
  const dir = createReportDir(JOB_NAME)
  const checks = []

  for (const check of HEALTH_CHECKS) {
    const command = runNpmScript(check.script)
    let reportDir = ''
    let summary: any = {}
    let failures: string[] = []

    if (command.exitCode !== 0) {
      failures.push(`command exited with ${command.exitCode}`)
    }

    try {
      try {
        reportDir = readLatestReportDir(check.logName)
      } catch (_error: any) {
        reportDir = reportDirFromOutput(`${command.stdout}\n${command.stderr}`, check.logName)
      }
      if (!reportDir) {
        throw new Error(`No report directory found for ${check.logName}`)
      }
      summary = readJson(path.join(reportDir, check.summaryFile))
      failures.push(...validateSummary(check.key, summary))
    } catch (error: any) {
      failures.push(`failed to read ${check.summaryFile}: ${error?.message ?? String(error)}`)
    }

    checks.push({
      key: check.key,
      script: check.script,
      exitCode: command.exitCode,
      reportDir,
      failures,
      summary,
      stdoutTail: command.stdout.split(/\r?\n/).filter(Boolean).slice(-12),
      stderrTail: command.stderr.split(/\r?\n/).filter(Boolean).slice(-12)
    })
  }

  const report = {
    checkedAt: new Date().toISOString(),
    baselineBackupPath: BASELINE_BACKUP_PATH,
    summary: {
      ok: checks.every(check => check.failures.length === 0),
      checks: checks.length,
      failedChecks: checks.filter(check => check.failures.length > 0).length
    },
    checks
  }

  writeJson(dir, 'summary.json', report.summary)
  writeJson(dir, 'checks.json', checks)
  writeText(dir, 'manual-review.md', renderMarkdown(report))
  writeJson(dir, 'apply-result.json', {
    mode: 'dry-run',
    applied: false,
    reason: 'Read-only post-migration health check.'
  })

  console.log(`NocoDB post-migration health written to ${dir}`)
  console.log(JSON.stringify(report.summary, null, 2))
  if (!report.summary.ok) {
    process.exitCode = 1
  }
}

function runTests(): void {
  const clean = buildFixtureReport({
    relations: { unsafeCounts: { missingClientRef: 0 } },
    dolphin: { profileExistsNotBound: 0, nocoProfileMissingInDolphin: 0, conflictsAndDuplicates: 0 },
    clientStatus: { patches: 5, conflicts: 2, byStatus: { unknown: 1 } },
    stopCompanies: { companyCreatePlans: 0, restrictionCompanyLinkPlans: 0, missingClientRelationReview: 0, ambiguousCompanyReview: 0, duplicateCompanyNames: 0 },
    syncMarkets: { patches: 0, links: 0, unknown: 0 },
    syncMentors: { missingStacks: [], unmatchedClients: 2 },
    refReadiness: { readyNativeRelations: 19, expectedNativeRelations: 19, blockedNativeRelations: 0, codeUsageBlockedColumns: 0, blockers: [] },
    cleanupAudit: { byCategory: { keep: 358 } }
  }) as any
  assert.equal(clean.summary.ok, true)

  const dirty = buildFixtureReport({
    relations: { unsafeCounts: { missingClientRef: 1 } },
    cleanupAudit: { byCategory: { keep: 357, drop_candidate: 1 } }
  }) as any
  assert.equal(dirty.summary.ok, false)
}

async function main(): Promise<void> {
  const args = parseJobArgs()
  if (args.test) {
    runTests()
    console.log('noco:post-migration-health tests passed')
    return
  }
  if (args.apply) {
    throw new Error('post-migration-health is read-only. Use --dry-run.')
  }
  await run()
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(describeError(error))
    process.exitCode = 1
  })
}

module.exports = {
  HEALTH_CHECKS,
  BASELINE_BACKUP_PATH,
  buildFixtureReport,
  validateSummary
}
