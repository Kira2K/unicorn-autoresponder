require('dotenv').config({ quiet: true })

const {
  createClientAutomationRepository
} = require('./sheets/automation-repository.ts')
const {
  assertDolphinAppRunning,
  assertPreexistingDolphinProfileLimit,
  getRunningDolphinBrowserProfileIds,
  getStartedProfileIds,
  stopStartedProfiles
} = require('./dolphin/index.ts')
const {
  attachHHAuthCredentials,
  getConfiguredAutomationTargetOptions,
  getConfiguredClientIds,
  getConfiguredClientNames,
  selectClientsByCommonChatIds,
  selectClientsByUniqueNames
} = require('./orchestrator/clients.ts')
const { runClientOrchestrator } = require('./orchestrator/client-runner.ts')
const {
  isClientReportSuccessful,
  sendRunErrorLog,
  sendRunSummaryLog,
  writeLocalRunLog
} = require('./orchestrator/reporting.ts')
const {
  getErrorMessage,
  getErrorStack,
  wait
} = require('./orchestrator/runtime-utils.ts')
const { openScenarioAndInjectIndex } = require('./orchestrator/scenario-runner.ts')
const { splitTelegramMessage } = require('./orchestrator/reports.ts')
const {
  AUTO_RESPONDER_WATCH_MS,
  CLIENT_START_DELAY_MS,
  EXTERNAL_TIMEOUT_MULTIPLIER,
  EXTERNAL_TIMEOUT_PROFILE_BUFFER_MS,
  LOCAL_RUN_LOG_FILE,
  ORCHESTRATOR_WORK_WITH_MARKET
} = require('./orchestrator/config.ts')

type ClientAutomationData = import('./orchestrator/types.ts').ClientAutomationData
type OrchestratorStatus = import('./orchestrator/types.ts').OrchestratorStatus

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
  await sendRunSummaryLog(results)

  return results
}

async function runSelectedClientsOrchestrator(
  clientNames: string[]
): Promise<OrchestratorStatus[]> {
  const repository = await createClientAutomationRepository()
  const allClients: ClientAutomationData[] =
    repository.getAllAutomationTargets(getConfiguredAutomationTargetOptions())
  const selectedClients = attachHHAuthCredentials(
    selectClientsByUniqueNames(allClients, clientNames),
    repository
  )

  return runClientsOrchestrator(selectedClients)
}

async function runSelectedClientIdsOrchestrator(
  clientIds: string[]
): Promise<OrchestratorStatus[]> {
  const repository = await createClientAutomationRepository()
  const allClients: ClientAutomationData[] =
    repository.getAllAutomationTargets(getConfiguredAutomationTargetOptions())
  const selectedClients = attachHHAuthCredentials(
    selectClientsByCommonChatIds(allClients, clientIds),
    repository
  )

  return runClientsOrchestrator(selectedClients)
}

async function runAllClientsOrchestrator(): Promise<OrchestratorStatus[]> {
  const repository = await createClientAutomationRepository()
  const clients: ClientAutomationData[] = attachHHAuthCredentials(
    repository.getAllAutomationTargets(getConfiguredAutomationTargetOptions()),
    repository
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
  const cleanupAndExit = async (signal: string) => {
    if (cleanupStarted) {
      return
    }

    cleanupStarted = true
    console.error(
      `Received ${signal}; stopping started Dolphin profiles before exit`
    )
    writeLocalRunLog({
      kind: 'process-signal',
      signal,
      startedProfileIds: getStartedProfileIds()
    })
    await stopStartedProfiles()
    process.exit(signal === 'SIGINT' ? 130 : 143)
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

if (require.main === module) {
  installProcessShutdownCleanup()

  runConfiguredOrchestrator()
    .then(() => process.exit(0))
    .catch(async (error: unknown) => {
      console.error(error instanceof Error ? error.stack : error)
      writeLocalRunLog({
        kind: 'run-fatal-error',
        error: getErrorMessage(error),
        errorStack: getErrorStack(error)
      })
      await sendRunErrorLog(error)
      process.exit(1)
    })
}

module.exports = {
  assertDolphinAppRunning,
  assertPreexistingDolphinProfileLimit,
  getLocalRunLogFile: () => LOCAL_RUN_LOG_FILE,
  getRecommendedExternalTimeoutMs,
  getRunningDolphinBrowserProfileIds,
  openScenarioAndInjectIndex,
  runAllClientsOrchestrator,
  runClientOrchestrator,
  runConfiguredOrchestrator,
  isClientReportSuccessful,
  selectClientsByCommonChatIds,
  selectClientsByUniqueNames,
  splitTelegramMessage
}
