const fs = require('node:fs')
const path = require('node:path')

const {
  evaluateResponseRequirement
} = require('../hh-responses/orchestrator/scraper-state.ts') as {
  evaluateResponseRequirement(status: Record<string, unknown>): {
    requiredResponseLimit?: number
    metResponseLimit?: boolean
    completionGap?: string
    responsesRemaining?: number
  }
}

type JsonRecord = Record<string, unknown>

type ClientRunAnalysis = {
  clientName: string
  market?: string
  stack?: string
  responseCount?: number
  requiredResponseLimit?: number
  metResponseLimit: boolean
  completionGap: string
  stopReason?: string
  manualVacanciesCount?: number
  parserErrorLogsCount?: number
  error?: string
  suggestedFix: string
}

type RunFileAnalysis = {
  file: string
  watchMs?: number
  responseLimit?: number
  configuredClients: number
  statusCount: number
  incomplete: boolean
  fatalReason?: string
  lastClientEvent?: JsonRecord
  clients: ClientRunAnalysis[]
}

function parseJsonl(filePath: string): JsonRecord[] {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line: string) => {
      try {
        return JSON.parse(line)
      } catch (error: unknown) {
        return {
          kind: 'parse-error',
          error: error instanceof Error ? error.message : String(error)
        }
      }
    })
}

function newestRunFiles(logDir: string, limit = 10): string[] {
  return fs.readdirSync(logDir)
    .filter((name: string) => /^orchestrator-run-.*\.jsonl$/.test(name))
    .map((name: string) => ({
      name,
      fullPath: path.join(logDir, name),
      mtime: fs.statSync(path.join(logDir, name)).mtimeMs
    }))
    .sort((left: { mtime: number }, right: { mtime: number }) => right.mtime - left.mtime)
    .slice(0, limit)
    .map((item: { fullPath: string }) => item.fullPath)
}

function getRunStart(records: JsonRecord[]): JsonRecord | undefined {
  return records.find(record =>
    record.kind === 'run-start' ||
    (record.localRunLogFile && Array.isArray(record.clients))
  )
}

function getRunExit(records: JsonRecord[]): JsonRecord | undefined {
  return records.find(record => record.kind === 'run-exit')
}

function getClientStatuses(records: JsonRecord[]): JsonRecord[] {
  return records
    .filter(record => record.kind === 'client-final-status' && record.status)
    .map(record => record.status as JsonRecord)
}

function getLastClientEvent(records: JsonRecord[]): JsonRecord | undefined {
  return [...records].reverse().find(record => record.kind === 'client-lifecycle')
}

function suggestFix(status: JsonRecord, gap: string): string {
  const error = String(status.error ?? '')
  const stopReason = String(status.autoResponderStopReason ?? '')

  if (/missing password/i.test(error)) {
    return 'Add missing HH password in client credentials before selecting this client.'
  }
  if (/auth validation stayed unknown|login form did not open/i.test(error)) {
    return 'Run HH auth preflight and repair login/captcha state before starting Dolphin automation.'
  }
  if (stopReason === 'manual_targets_only') {
    return 'Inspect manual blocker checks, skip/save manual response pages faster, and continue to later vacancies.'
  }
  if (stopReason === 'orchestrator_stop_after_watch') {
    return 'Increase watchMs or reduce selected clients/stagger so the client has enough time to reach the response limit.'
  }
  if (stopReason === 'no_new_targets') {
    return 'Refresh scenario filters or accept that no reachable vacancies remain for this client.'
  }
  if (gap === 'response_limit_unknown') {
    return 'Log responseLimit on run-start and client-final-status; old run cannot prove requirement success.'
  }
  if (error) {
    return 'Fix the reported client error before counting the run toward requirements.'
  }

  return 'Review stop reason and response gap; requirement was not proven.'
}

function analyzeClientStatus(
  status: JsonRecord,
  runResponseLimit?: number
): ClientRunAnalysis {
  const statusWithRequirement = {
    ...status,
    requiredResponseLimit: status.requiredResponseLimit ?? runResponseLimit
  }
  const requirement = evaluateResponseRequirement(statusWithRequirement)
  const completionGap = requirement.completionGap ?? 'requirement_not_proven'

  return {
    clientName: String(status.clientName ?? 'unknown'),
    market: typeof status.market === 'string' ? status.market : undefined,
    stack: typeof status.stack === 'string' ? status.stack : undefined,
    responseCount: typeof status.responseCount === 'number' ? status.responseCount : undefined,
    requiredResponseLimit: requirement.requiredResponseLimit,
    metResponseLimit: requirement.metResponseLimit === true,
    completionGap,
    stopReason: typeof status.autoResponderStopReason === 'string'
      ? status.autoResponderStopReason
      : undefined,
    manualVacanciesCount: typeof status.manualVacanciesCount === 'number'
      ? status.manualVacanciesCount
      : undefined,
    parserErrorLogsCount: typeof status.parserErrorLogsCount === 'number'
      ? status.parserErrorLogsCount
      : undefined,
    error: typeof status.error === 'string' ? status.error : undefined,
    suggestedFix: suggestFix(status, completionGap)
  }
}

function analyzeRunFile(filePath: string): RunFileAnalysis {
  const records = parseJsonl(filePath)
  const runStart = getRunStart(records)
  const runExit = getRunExit(records)
  const statuses = getClientStatuses(records)
  const configuredClients = Array.isArray(runStart?.clients)
    ? runStart.clients.length
    : 0
  const responseLimit = typeof runStart?.responseLimit === 'number'
    ? runStart.responseLimit
    : undefined
  const watchMs = typeof runStart?.watchMs === 'number'
    ? runStart.watchMs
    : undefined

  return {
    file: path.basename(filePath),
    watchMs,
    responseLimit,
    configuredClients,
    statusCount: statuses.length,
    incomplete: statuses.length === 0 || (!runExit && configuredClients > statuses.length),
    fatalReason: typeof runExit?.reason === 'string' ? runExit.reason : undefined,
    lastClientEvent: getLastClientEvent(records),
    clients: statuses.map(status => analyzeClientStatus(status, responseLimit))
  }
}

function analyzeRecentRuns(options: {
  logDir?: string
  limit?: number
} = {}): RunFileAnalysis[] {
  const logDir = options.logDir ?? path.resolve(__dirname, '../../../logs')
  const limit = options.limit ?? 10

  return newestRunFiles(logDir, limit).map(analyzeRunFile)
}

function summarizeAnalyses(analyses: RunFileAnalysis[]): Record<string, unknown> {
  const clients = analyses.flatMap(run => run.clients)
  const unmetClients = clients.filter(client => !client.metResponseLimit)

  return {
    files: analyses.length,
    incompleteRuns: analyses.filter(run => run.incomplete).length,
    clientStatuses: clients.length,
    metResponseLimit: clients.filter(client => client.metResponseLimit).length,
    unmetResponseLimit: unmetClients.length,
    topCompletionGaps: unmetClients.reduce((summary: Record<string, number>, client) => {
      summary[client.completionGap] = (summary[client.completionGap] ?? 0) + 1
      return summary
    }, {})
  }
}

if (require.main === module) {
  const analyses = analyzeRecentRuns()
  console.log(JSON.stringify({
    summary: summarizeAnalyses(analyses),
    runs: analyses
  }, null, 2))
}

module.exports = {
  analyzeClientStatus,
  analyzeRecentRuns,
  analyzeRunFile,
  parseJsonl,
  summarizeAnalyses
}
