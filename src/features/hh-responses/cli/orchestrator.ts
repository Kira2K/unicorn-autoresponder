require('dotenv').config({ quiet: true })

const {
  createAppDb
} = require('../../../platform/db/index.ts')
const {
  assertDolphinAppRunning,
  assertPreexistingDolphinProfileLimit,
  getRunningDolphinBrowserProfileIds,
  getStartedProfileIds,
  stopStartedProfiles
} = require('../../../integrations/dolphin/index.ts')
const {
  attachHHAuthCredentials,
  attachBlockedCompanies,
  getConfiguredAutomationTargetOptions,
  getConfiguredClientIds,
  getConfiguredClientNames,
  selectClientsByCommonChatIds,
  selectClientsByUniqueNames
} = require('../orchestrator/clients.ts')
const { runClientOrchestrator } = require('../orchestrator/client-runner.ts')
const {
  isClientReportSuccessful,
  sendRunErrorLog,
  sendRunSummaryLog,
  writeLocalRunLog
} = require('../orchestrator/reporting.ts')
const {
  getErrorMessage,
  getErrorStack,
  wait,
  withTimeout
} = require('../orchestrator/runtime-utils.ts')
const { openScenarioAndInjectIndex } = require('../orchestrator/scenario-runner.ts')
const { splitTelegramMessage } = require('../orchestrator/reports.ts')
const {
  AUTO_RESPONDER_WATCH_MS,
  CLIENT_START_DELAY_MS,
  DOLPHIN_LOCAL_API_BASE_URL,
  EXTERNAL_TIMEOUT_MULTIPLIER,
  EXTERNAL_TIMEOUT_PROFILE_BUFFER_MS,
  LOCAL_RUN_LOG_FILE,
  ORCHESTRATOR_WORK_WITH_MARKET
} = require('../orchestrator/config.ts')

type ClientAutomationData = import('../orchestrator/types.ts').ClientAutomationData
type OrchestratorStatus = import('../orchestrator/types.ts').OrchestratorStatus

const RUN_REPORT_TIMEOUT_MS = Number(
  process.env.ORCHESTRATOR_FINAL_REPORT_TIMEOUT_MS ?? 30000
)
const RUN_CLEANUP_TIMEOUT_MS = Number(
  process.env.ORCHESTRATOR_FINAL_CLEANUP_TIMEOUT_MS ?? 30000
)
let runExitLogged = false

function writeRunExitLog(options: {
  exitCode: number
  reason: string
  resultsCount?: number
  error?: unknown
}): void {
  if (runExitLogged) {
    return
  }

  runExitLogged = true
  writeLocalRunLog({
    kind: 'run-exit',
    exitCode: options.exitCode,
    reason: options.reason,
    resultsCount: options.resultsCount,
    startedProfileIds: getStartedProfileIds(),
    error: options.error ? getErrorMessage(options.error) : undefined,
    errorStack: options.error ? getErrorStack(options.error) : undefined
  })
}

function getRunCompletionReason(results: OrchestratorStatus[]): string {
  return results.every(isClientReportSuccessful)
    ? 'success'
    : 'completed-with-client-errors'
}

async function sendRunSummaryLogWithTimeout(
  results: OrchestratorStatus[]
): Promise<void> {
  try {
    await withTimeout(
      sendRunSummaryLog(results),
      RUN_REPORT_TIMEOUT_MS,
      `Run summary Telegram report timed out after ${RUN_REPORT_TIMEOUT_MS}ms`
    )
  } catch (error: unknown) {
    console.error(`Failed to send run summary: ${getErrorMessage(error)}`)
    writeLocalRunLog({
      kind: 'run-summary-send-failed',
      timeoutMs: RUN_REPORT_TIMEOUT_MS,
      error: getErrorMessage(error),
      errorStack: getErrorStack(error)
    })
  }
}

async function sendRunErrorLogWithTimeout(error: unknown): Promise<void> {
  try {
    await withTimeout(
      sendRunErrorLog(error),
      RUN_REPORT_TIMEOUT_MS,
      `Run error Telegram report timed out after ${RUN_REPORT_TIMEOUT_MS}ms`
    )
  } catch (reportError: unknown) {
    console.error(`Failed to send run error report: ${getErrorMessage(reportError)}`)
    writeLocalRunLog({
      kind: 'run-error-send-failed',
      timeoutMs: RUN_REPORT_TIMEOUT_MS,
      error: getErrorMessage(reportError),
      errorStack: getErrorStack(reportError)
    })
  }
}

async function stopStartedProfilesWithTimeout(reason: string): Promise<void> {
  try {
    await withTimeout(
      stopStartedProfiles(),
      RUN_CLEANUP_TIMEOUT_MS,
      `Started Dolphin profile cleanup timed out after ${RUN_CLEANUP_TIMEOUT_MS}ms`
    )
  } catch (error: unknown) {
    console.error(
      `Failed to stop started Dolphin profiles during ${reason}: ${getErrorMessage(error)}`
    )
    writeLocalRunLog({
      kind: 'run-cleanup-failed',
      reason,
      timeoutMs: RUN_CLEANUP_TIMEOUT_MS,
      startedProfileIds: getStartedProfileIds(),
      error: getErrorMessage(error),
      errorStack: getErrorStack(error)
    })
  }
}

function getRecommendedExternalTimeoutMs(
  clientCount: number,
  watchMs = AUTO_RESPONDER_WATCH_MS,
  clientStartDelayMs = CLIENT_START_DELAY_MS
): number {
  const staggerTotalMs = Math.max(clientCount - 1, 0) * clientStartDelayMs
  const profileBufferMs = clientCount * EXTERNAL_TIMEOUT_PROFILE_BUFFER_MS

  return Math.ceil(
    (watchMs + staggerTotalMs + profileBufferMs) * EXTERNAL_TIMEOUT_MULTIPLIER
  )
}

async function runClientsOrchestrator(
  clients: ClientAutomationData[]
): Promise<OrchestratorStatus[]> {
  await assertDolphinAppRunning()
  writeLocalRunLog({
    kind: 'dolphin-local-api-preflight',
    baseUrl: DOLPHIN_LOCAL_API_BASE_URL,
    authEndpoint: '/auth/login-with-token',
    tokenSeeded: true
  })
  await assertPreexistingDolphinProfileLimit()

  if (!clients.length) {
    throw new Error('No enabled client market targets were found')
  }

  console.log(
    `Starting ${clients.length} clients with ${CLIENT_START_DELAY_MS}ms stagger: ${clients
      .map(
        client =>
          `${client.clientName}/${client.commonChatId}/${client.market}(${client.dolphinProfileId})`
      )
      .join(', ')}`
  )
  console.log(
    `Recommended external timeout: ${getRecommendedExternalTimeoutMs(clients.length)}ms ` +
      `(formula: (watchMs + staggerMs + ${EXTERNAL_TIMEOUT_PROFILE_BUFFER_MS}ms * profiles) * ${EXTERNAL_TIMEOUT_MULTIPLIER})`
  )
  writeLocalRunLog({
    kind: 'run-start',
    localRunLogFile: LOCAL_RUN_LOG_FILE,
    market: ORCHESTRATOR_WORK_WITH_MARKET,
    watchMs: AUTO_RESPONDER_WATCH_MS,
    clientStartDelayMs: CLIENT_START_DELAY_MS,
    recommendedExternalTimeoutMs: getRecommendedExternalTimeoutMs(
      clients.length
    ),
    clients: clients.map(client => ({
      clientName: client.clientName,
      commonChatId: client.commonChatId,
      market: client.market,
      stack: client.stack,
      dolphinProfileId: client.dolphinProfileId
    }))
  })

  const results = await Promise.all(
    clients.map(async (client, index) => {
      const delayMs = index * CLIENT_START_DELAY_MS

      if (delayMs > 0) {
        console.log(
          `Waiting ${delayMs}ms before starting ${client.clientName}/${client.market}(${client.dolphinProfileId})`
        )
        await wait(delayMs)
      }

      return runClientOrchestrator(client)
    })
  )

  console.log(results)
  writeLocalRunLog({
    kind: 'run-results',
    results
  })
  await sendRunSummaryLogWithTimeout(results)

  return results
}

async function runSelectedClientsOrchestrator(
  clientNames: string[]
): Promise<OrchestratorStatus[]> {
  const db = createAppDb()
  const allClients: ClientAutomationData[] =
    await db.getAutomationTargets(getConfiguredAutomationTargetOptions())
  const selectedClients = await attachHHAuthCredentials(
    attachBlockedCompanies(selectClientsByUniqueNames(allClients, clientNames)),
    db
  )

  return runClientsOrchestrator(selectedClients)
}

async function runSelectedClientIdsOrchestrator(
  clientIds: string[]
): Promise<OrchestratorStatus[]> {
  const db = createAppDb()
  const allClients: ClientAutomationData[] =
    await db.getAutomationTargets(getConfiguredAutomationTargetOptions())
  const selectedClients = await attachHHAuthCredentials(
    attachBlockedCompanies(selectClientsByCommonChatIds(allClients, clientIds)),
    db
  )

  return runClientsOrchestrator(selectedClients)
}

async function runAllClientsOrchestrator(): Promise<OrchestratorStatus[]> {
  const db = createAppDb()
  const clients: ClientAutomationData[] = await attachHHAuthCredentials(
    attachBlockedCompanies(
      await db.getAutomationTargets(getConfiguredAutomationTargetOptions())
    ),
    db
  )

  return runClientsOrchestrator(clients)
}

async function runConfiguredOrchestrator(): Promise<OrchestratorStatus[]> {
  const clientIds = getConfiguredClientIds()
  const clientNames = getConfiguredClientNames()

  if (clientIds.length) {
    if (clientNames.length) {
      console.warn(
        'ORCHESTRATOR_CLIENT_IDS is set; ignoring ORCHESTRATOR_CLIENT_NAMES.'
      )
    }

    return runSelectedClientIdsOrchestrator(clientIds)
  }

  if (clientNames.length) {
    return runSelectedClientsOrchestrator(clientNames)
  }

  return runAllClientsOrchestrator()
}

function installProcessShutdownCleanup(): void {
  let cleanupStarted = false
  const cleanupAndExit = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (cleanupStarted) {
      return
    }

    cleanupStarted = true
    const exitCode = signal === 'SIGINT' ? 130 : 143
    console.error(
      `Received ${signal}; stopping started Dolphin profiles before exit`
    )
    writeLocalRunLog({
      kind: 'process-signal',
      signal,
      startedProfileIds: getStartedProfileIds()
    })
    await stopStartedProfilesWithTimeout(signal)
    writeRunExitLog({
      exitCode,
      reason: signal
    })
    process.exit(exitCode)
  }

  process.once('SIGINT', () => {
    cleanupAndExit('SIGINT').catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : error)
      process.exit(130)
    })
  })
  process.once('SIGTERM', () => {
    cleanupAndExit('SIGTERM').catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : error)
      process.exit(143)
    })
  })
}

async function main(): Promise<void> {
  installProcessShutdownCleanup()

  await runConfiguredOrchestrator()
    .then((results: OrchestratorStatus[]) => {
      writeRunExitLog({
        exitCode: 0,
        reason: getRunCompletionReason(results),
        resultsCount: results.length
      })
      process.exit(0)
    })
    .catch(async (error: unknown) => {
      console.error(error instanceof Error ? error.stack : error)
      writeLocalRunLog({
        kind: 'run-fatal-error',
        error: getErrorMessage(error),
        errorStack: getErrorStack(error)
      })
      await sendRunErrorLogWithTimeout(error)
      await stopStartedProfilesWithTimeout('fatal-error')
      writeRunExitLog({
        exitCode: 1,
        reason: 'fatal-error',
        error
      })
      process.exit(1)
    })
}

if (require.main === module) {
  main()
}

module.exports = {
  assertDolphinAppRunning,
  assertPreexistingDolphinProfileLimit,
  getLocalRunLogFile: () => LOCAL_RUN_LOG_FILE,
  getRecommendedExternalTimeoutMs,
  getRunningDolphinBrowserProfileIds,
  openScenarioAndInjectIndex,
  main,
  runAllClientsOrchestrator,
  runClientOrchestrator,
  runConfiguredOrchestrator,
  isClientReportSuccessful,
  selectClientsByCommonChatIds,
  selectClientsByUniqueNames,
  splitTelegramMessage
}
