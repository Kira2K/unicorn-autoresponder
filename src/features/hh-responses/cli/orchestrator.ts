require('dotenv').config({ quiet: true })
const fs = require('node:fs')

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
  attachHHAuthCredentialsBestEffort,
  attachBlockedCompanies,
  applyConfiguredClientExclusions,
  getConfiguredAutomationTargetOptions,
  getConfiguredClientIds,
  getConfiguredClientNames,
  selectClientsByCommonChatIds,
  selectClientsByUniqueNames
} = require('../orchestrator/clients.ts') as {
  attachHHAuthCredentials: Function
  attachHHAuthCredentialsBestEffort: Function
  attachBlockedCompanies: Function
  applyConfiguredClientExclusions(clients: ClientAutomationData[]): {
    clients: ClientAutomationData[]
    excluded: ClientAutomationData[]
    excludedNames: string[]
    excludedIds: string[]
  }
  getConfiguredAutomationTargetOptions: Function
  getConfiguredClientIds: Function
  getConfiguredClientNames: Function
  selectClientsByCommonChatIds: Function
  selectClientsByUniqueNames: Function
}
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
  ORCHESTRATOR_CONCURRENCY,
  ORCHESTRATOR_IDLE_TIMEOUT_MS,
  ORCHESTRATOR_RESPONSE_LIMIT,
  ORCHESTRATOR_SUPERVISED,
  ORCHESTRATOR_WORK_WITH_MARKET
} = require('../orchestrator/config.ts')
const {
  applyResponseRequirementStatus
} = require('../orchestrator/scraper-state.ts')

type ClientAutomationData = import('../orchestrator/types.ts').ClientAutomationData
type OrchestratorStatus = import('../orchestrator/types.ts').OrchestratorStatus

const RUN_REPORT_TIMEOUT_MS = Number(
  process.env.ORCHESTRATOR_FINAL_REPORT_TIMEOUT_MS ?? 30000
)
const RUN_CLEANUP_TIMEOUT_MS = Number(
  process.env.ORCHESTRATOR_FINAL_CLEANUP_TIMEOUT_MS ?? 30000
)
let runExitLogged = false
let latestRunSummaryStatuses: OrchestratorStatus[] = []
let latestRunSummaryDelivery: unknown

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
    latestRunSummaryDelivery,
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
  results: OrchestratorStatus[],
  reason = 'final'
): Promise<void> {
  try {
    const delivery = await withTimeout(
      sendRunSummaryLog(results),
      RUN_REPORT_TIMEOUT_MS,
      `Run summary Telegram report timed out after ${RUN_REPORT_TIMEOUT_MS}ms`
    )
    latestRunSummaryDelivery = delivery
  } catch (error: unknown) {
    console.error(`Failed to send run summary: ${getErrorMessage(error)}`)
    writeLocalRunLog({
      kind: 'run-summary-send-failed',
      reason,
      timeoutMs: RUN_REPORT_TIMEOUT_MS,
      error: getErrorMessage(error),
      errorStack: getErrorStack(error)
    })
  }
}

function readContinuationCompletedClientIds(): Set<string> {
  const continuationLog = process.env.ORCHESTRATOR_CONTINUE_FROM_LOG?.trim()

  if (!continuationLog) {
    return new Set()
  }

  const completedClientIds = new Set<string>()
  const lines = fs.readFileSync(continuationLog, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    if (!line.trim()) {
      continue
    }

    try {
      const record = JSON.parse(line)
      const status = record?.kind === 'client-final-status'
        ? record.status
        : undefined
      const commonChatId = status?.commonChatId

      if (typeof commonChatId === 'string' && commonChatId.trim()) {
        completedClientIds.add(commonChatId)
      }
    } catch {
      // Ignore corrupt historical lines; the current run will still log preflight.
    }
  }

  writeLocalRunLog({
    kind: 'run-continuation-loaded',
    continuationLog,
    completedClientIds: [...completedClientIds]
  })

  return completedClientIds
}

function applyContinuationFilter(
  clients: ClientAutomationData[]
): {
  clients: ClientAutomationData[]
  skipped: ClientAutomationData[]
} {
  const completedClientIds = readContinuationCompletedClientIds()

  if (!completedClientIds.size) {
    return {
      clients,
      skipped: []
    }
  }

  const keptClients: ClientAutomationData[] = []
  const skipped: ClientAutomationData[] = []

  for (const client of clients) {
    if (completedClientIds.has(client.commonChatId)) {
      skipped.push(client)
      continue
    }

    keptClients.push(client)
  }

  writeLocalRunLog({
    kind: 'run-continuation-filtered',
    skippedClients: skipped.map(client => ({
      clientName: client.clientName,
      commonChatId: client.commonChatId,
      market: client.market
    })),
    remainingClients: keptClients.length
  })

  return {
    clients: keptClients,
    skipped
  }
}

function prepareSelectedClients(
  clients: ClientAutomationData[]
): ClientAutomationData[] {
  const exclusions = applyConfiguredClientExclusions(clients)
  if (exclusions.excluded.length) {
    console.warn(
      `Excluding clients: ${exclusions.excluded
        .map(client => `${client.clientName}/${client.commonChatId}`)
        .join(', ')}`
    )
  }
  writeLocalRunLog({
    kind: 'run-client-selection-preflight',
    requestedClients: clients.map(client => ({
      clientName: client.clientName,
      commonChatId: client.commonChatId,
      market: client.market
    })),
    excludedNames: exclusions.excludedNames,
    excludedIds: exclusions.excludedIds,
    excludedClients: exclusions.excluded.map(client => ({
      clientName: client.clientName,
      commonChatId: client.commonChatId,
      market: client.market
    }))
  })

  const continuation = applyContinuationFilter(exclusions.clients)

  return continuation.clients
}

async function sendRunCheckpointLogWithTimeout(
  results: OrchestratorStatus[],
  reason: string
): Promise<void> {
  if (!results.length) {
    return
  }

  latestRunSummaryStatuses = [...results]
  writeLocalRunLog({
    kind: 'run-checkpoint',
    reason,
    results
  })
  await sendRunSummaryLogWithTimeout(results, reason)
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
  clientStartDelayMs = CLIENT_START_DELAY_MS,
  concurrency = ORCHESTRATOR_CONCURRENCY
): number | undefined {
  if (watchMs === undefined) {
    return undefined
  }

  const safeConcurrency = Math.max(1, Math.floor(Number(concurrency) || 1))
  const clientBatches = Math.ceil(clientCount / safeConcurrency)
  const watchTotalMs = clientBatches * watchMs
  const staggerTotalMs = Math.max(clientCount - 1, 0) * clientStartDelayMs
  const profileBufferMs = clientCount * EXTERNAL_TIMEOUT_PROFILE_BUFFER_MS

  return Math.ceil(
    (watchTotalMs + staggerTotalMs + profileBufferMs) * EXTERNAL_TIMEOUT_MULTIPLIER
  )
}

async function runWithBoundedConcurrency<T, R>(
  items: T[],
  options: {
    concurrency: number
    startDelayMs: number
    runItem: (item: T, index: number) => Promise<R>
    getWaitMessage?: (item: T, index: number, waitMs: number) => string
  }
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.floor(Number(options.concurrency) || 1))
  )
  const startDelayMs = Math.max(0, Number(options.startDelayMs) || 0)
  let nextIndex = 0
  let nextStartAt = 0
  let startGate: Promise<void> = Promise.resolve()

  async function waitForStartTurn(item: T, index: number): Promise<void> {
    const previousGate = startGate
    let releaseGate: () => void = () => undefined

    startGate = new Promise<void>(resolve => {
      releaseGate = resolve
    })

    await previousGate

    try {
      const waitMs = Math.max(nextStartAt - Date.now(), 0)

      if (waitMs > 0) {
        const message = options.getWaitMessage?.(item, index, waitMs)

        if (message) {
          console.log(message)
        }

        await wait(waitMs)
      }

      nextStartAt = Date.now() + startDelayMs
    } finally {
      releaseGate()
    }
  }

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      const item = items[index]

      await waitForStartTurn(item, index)
      results[index] = await options.runItem(item, index)
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker())
  )

  return results
}

function getClientReadinessError(client: ClientAutomationData): Error | null {
  if (!client.stackScenario) {
    return new Error(`Stack scenario for ${client.clientName} was not found`)
  }

  if (!Number.isFinite(Number(client.dolphinProfileId)) || Number(client.dolphinProfileId) <= 0) {
    return new Error(`Dolphin profile id for ${client.clientName} is missing or invalid`)
  }

  if (!client.hhAuthCredentials) {
    return new Error(`HH credentials for ${client.clientName}/${client.market ?? 'unknown'} are missing`)
  }

  if (!String(client.hhAuthCredentials.password ?? '').trim()) {
    return new Error(`HH password for ${client.clientName}/${client.market ?? 'unknown'} is missing`)
  }

  if (!String(client.hhAuthCredentials.email ?? '').trim()) {
    return new Error(`HH email for ${client.clientName}/${client.market ?? 'unknown'} is missing`)
  }

  return null
}

function splitClientsByReadiness(clients: ClientAutomationData[]): {
  clients: ClientAutomationData[]
  skippedStatuses: OrchestratorStatus[]
} {
  const runnableClients: ClientAutomationData[] = []
  const skippedStatuses: OrchestratorStatus[] = []

  for (const client of clients) {
    const error = getClientReadinessError(client)
    if (!error) {
      runnableClients.push(client)
      continue
    }

    const status = makeClientPreparationErrorStatus(
      client,
      error,
      'client skipped before run: readiness preflight failed'
    )
    console.warn(
      `Skipping ${client.clientName}/${client.commonChatId}/${client.market}: ${error.message}`
    )
    writeLocalRunLog({
      kind: 'client-skipped-before-run',
      status
    })
    skippedStatuses.push(status)
  }

  return {
    clients: runnableClients,
    skippedStatuses
  }
}

async function runClientsOrchestrator(
  clients: ClientAutomationData[],
  options: {
    extraSummaryStatuses?: OrchestratorStatus[]
  } = {}
): Promise<OrchestratorStatus[]> {
  const readiness = splitClientsByReadiness(clients)
  const extraSummaryStatuses = [
    ...(options.extraSummaryStatuses ?? []),
    ...readiness.skippedStatuses
  ]

  if (!readiness.clients.length) {
    if (!extraSummaryStatuses.length) {
      throw new Error('No enabled client market targets were found')
    }

    console.warn('No runnable clients remained after readiness preflight.')
    writeLocalRunLog({
      kind: 'run-results',
      results: extraSummaryStatuses
    })
    await sendRunSummaryLogWithTimeout(extraSummaryStatuses)

    return extraSummaryStatuses
  }

  await assertDolphinAppRunning()
  writeLocalRunLog({
    kind: 'dolphin-local-api-preflight',
    baseUrl: DOLPHIN_LOCAL_API_BASE_URL,
    authEndpoint: '/auth/login-with-token',
    tokenSeeded: true
  })
  await assertPreexistingDolphinProfileLimit()

  console.log(
    `Starting ${readiness.clients.length} clients with concurrency ${ORCHESTRATOR_CONCURRENCY} ` +
      `and ${CLIENT_START_DELAY_MS}ms start delay: ${readiness.clients
      .map(
        client =>
          `${client.clientName}/${client.commonChatId}/${client.market}(${client.dolphinProfileId})`
      )
      .join(', ')}`
  )
  console.log(
    AUTO_RESPONDER_WATCH_MS === undefined
      ? 'Orchestrator watch timer disabled; run will wait for response limit or another terminal stop.'
      : `Recommended external timeout: ${getRecommendedExternalTimeoutMs(readiness.clients.length)}ms ` +
        `(formula: (watchMs + staggerMs + ${EXTERNAL_TIMEOUT_PROFILE_BUFFER_MS}ms * profiles) * ${EXTERNAL_TIMEOUT_MULTIPLIER})`
  )
  writeLocalRunLog({
    kind: 'run-start',
    localRunLogFile: LOCAL_RUN_LOG_FILE,
    market: ORCHESTRATOR_WORK_WITH_MARKET,
    responseLimit: ORCHESTRATOR_RESPONSE_LIMIT,
    supervised: ORCHESTRATOR_SUPERVISED,
    idleTimeoutMs: ORCHESTRATOR_IDLE_TIMEOUT_MS,
    watchMs: AUTO_RESPONDER_WATCH_MS,
    watchTimerDisabled: AUTO_RESPONDER_WATCH_MS === undefined,
    clientStartDelayMs: CLIENT_START_DELAY_MS,
    orchestratorConcurrency: ORCHESTRATOR_CONCURRENCY,
    recommendedExternalTimeoutMs: getRecommendedExternalTimeoutMs(
      readiness.clients.length
    ),
    clients: readiness.clients.map(client => ({
      clientName: client.clientName,
      commonChatId: client.commonChatId,
      market: client.market,
      stack: client.stack,
      dolphinProfileId: client.dolphinProfileId,
      responseLimit: ORCHESTRATOR_RESPONSE_LIMIT
    }))
  })

  const completedStatuses: OrchestratorStatus[] = []
  const results = await runWithBoundedConcurrency(readiness.clients, {
    concurrency: ORCHESTRATOR_CONCURRENCY,
    startDelayMs: CLIENT_START_DELAY_MS,
    getWaitMessage: (client, _index, waitMs) =>
      `Waiting ${waitMs}ms before starting ${client.clientName}/${client.market}(${client.dolphinProfileId})`,
    runItem: async client => {
      const status = await runClientOrchestrator(client).catch((error: unknown) => {
        const status = makeClientPreparationErrorStatus(
          client,
          error,
          'client run failed before final status'
        )
        writeLocalRunLog({
          kind: 'client-final-status',
          status
        })

        return status
      })

      const checkpointResults = [
        ...extraSummaryStatuses,
        ...completedStatuses,
        status
      ]
      completedStatuses.push(status)
      await sendRunCheckpointLogWithTimeout(
        checkpointResults,
        `client-finished:${client.clientName}/${client.market ?? 'unknown'}`
      )

      return status
    }
  })

  const summaryResults = [...extraSummaryStatuses, ...results]

  console.log(summaryResults)
  latestRunSummaryStatuses = [...summaryResults]
  writeLocalRunLog({
    kind: 'run-results',
    results: summaryResults
  })
  await sendRunSummaryLogWithTimeout(summaryResults)

  return summaryResults
}

function makeClientPreparationErrorStatus(
  client: ClientAutomationData,
  error: unknown,
  event: string
): OrchestratorStatus {
  return applyResponseRequirementStatus({
    clientName: client.clientName,
    stack: client.stack,
    market: client.market,
    dolphinProfileId: client.dolphinProfileId,
    commonChatId: client.commonChatId,
    stackScenario: client.stackScenario ?? '',
    lifecycleEvents: [
      {
        at: new Date().toISOString(),
        elapsedMs: 0,
        event,
        details: getErrorMessage(error)
      }
    ],
    opened: false,
    indexScriptInjected: false,
    watcherInstalled: false,
    startButtonClicked: false,
    requiredResponseLimit: ORCHESTRATOR_RESPONSE_LIMIT,
    metResponseLimit: false,
    completionGap: 'client_preparation_failed',
    responsesRemaining: ORCHESTRATOR_RESPONSE_LIMIT,
    responseLimitWatchMs: AUTO_RESPONDER_WATCH_MS,
    responseLimitElapsedMs: 0,
    responseLimitTimeLeftMs: AUTO_RESPONDER_WATCH_MS,
    error: getErrorMessage(error),
    errorStack: getErrorStack(error)
  })
}

async function runSelectedClientsOrchestrator(
  clientNames: string[]
): Promise<OrchestratorStatus[]> {
  const db = createAppDb()
  const allClients: ClientAutomationData[] =
    await db.getAutomationTargets(getConfiguredAutomationTargetOptions())
  const selectedClients = await attachHHAuthCredentials(
    attachBlockedCompanies(
      prepareSelectedClients(selectClientsByUniqueNames(allClients, clientNames))
    ),
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
    attachBlockedCompanies(
      prepareSelectedClients(selectClientsByCommonChatIds(allClients, clientIds))
    ),
    db
  )

  return runClientsOrchestrator(selectedClients)
}

async function runAllClientsOrchestrator(): Promise<OrchestratorStatus[]> {
  const db = createAppDb()
  const credentialAttachResult = await attachHHAuthCredentialsBestEffort(
    attachBlockedCompanies(
      prepareSelectedClients(
        await db.getAutomationTargets(getConfiguredAutomationTargetOptions())
      )
    ),
    db
  )
  const skippedStatuses = credentialAttachResult.skipped.map(
    (skip: { client: ClientAutomationData; error: unknown }) => {
      const { client, error } = skip
      const status = makeClientPreparationErrorStatus(
        client,
        error,
        'client skipped before run: HH credentials were not matched'
      )

      console.warn(
        `Skipping ${client.clientName}/${client.commonChatId}/${client.market}: ${getErrorMessage(error)}`
      )
      writeLocalRunLog({
        kind: 'client-skipped-before-run',
        status
      })

      return status
    }
  )

  if (!credentialAttachResult.clients.length) {
    if (!skippedStatuses.length) {
      return runClientsOrchestrator(credentialAttachResult.clients)
    }

    console.warn('No runnable clients remained after credential preflight.')
    writeLocalRunLog({
      kind: 'run-results',
      results: skippedStatuses
    })
    await sendRunSummaryLogWithTimeout(skippedStatuses)

    return skippedStatuses
  }

  return runClientsOrchestrator(credentialAttachResult.clients, {
    extraSummaryStatuses: skippedStatuses
  })
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
    await sendRunCheckpointLogWithTimeout(
      latestRunSummaryStatuses,
      `process-signal:${signal}`
    )
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
  runWithBoundedConcurrency,
  runAllClientsOrchestrator,
  runClientOrchestrator,
  runConfiguredOrchestrator,
  isClientReportSuccessful,
  selectClientsByCommonChatIds,
  selectClientsByUniqueNames,
  splitTelegramMessage
}
