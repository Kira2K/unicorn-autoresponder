require('dotenv').config({ quiet: true })

const {
  createAppDb
} = require('./db/index.ts')
const {
  assertDolphinAppRunning,
  assertPreexistingDolphinProfileLimit,
  getRunningDolphinBrowserProfileIds,
  getStartedProfileIds,
  stopStartedProfiles
} = require('./dolphin/index.ts')
const {
  attachHHAuthCredentials,
  attachBlockedCompanies,
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
  DOLPHIN_LOCAL_API_BASE_URL,
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

function getConfiguredResponseLimit(): number | undefined {
  const raw = String(process.env.ORCHESTRATOR_RESPONSE_LIMIT ?? '').trim()
  return raw ? Number(raw) : undefined
}

function shouldApplyKiraOnlyNocoTestGate(): boolean {
  return (
    String(process.env.APP_DB ?? '').trim().toLowerCase() === 'noco' &&
    String(process.env.ORCHESTRATOR_CLIENT_NAMES ?? '').trim() === 'Кира' &&
    String(process.env.ORCHESTRATOR_WORK_WITH_MARKET ?? '').trim().toLowerCase() === 'ru' &&
    String(process.env.ORCHESTRATOR_RESPONSE_LIMIT ?? '').trim() !== ''
  )
}

function assertKiraOnlyNocoTestGate(clients: ClientAutomationData[]): void {
  if (!shouldApplyKiraOnlyNocoTestGate()) {
    return
  }

  const responseLimit = getConfiguredResponseLimit()
  if (responseLimit !== 50 || responseLimit > 100) {
    throw new Error(
      `Kira Noco test requires ORCHESTRATOR_RESPONSE_LIMIT=50; got ${String(responseLimit)}`
    )
  }

  if (clients.length !== 1) {
    throw new Error(`Kira Noco test expected exactly one target; got ${clients.length}`)
  }

  const [client] = clients
  const problems = [
    client.clientName === 'Кира' ? '' : `clientName=${client.clientName}`,
    client.market === 'Ru' ? '' : `market=${client.market}`,
    client.dolphinProfileId === 770032142 ? '' : `dolphinProfileId=${client.dolphinProfileId}`,
    client.stack === 'FRONTEND' ? '' : `stack=${client.stack}`,
    client.commonChatId === '5216637594' ? '' : `commonChatId=${client.commonChatId}`,
    client.stackScenario ? '' : 'missing stackScenario'
  ].filter(Boolean)

  console.log(
    `Kira Noco test target: ${client.clientName}/${client.commonChatId}/${client.market}` +
      ` stack=${client.stack} dolphin=${client.dolphinProfileId} limit=${responseLimit}` +
      ` cover=${client.coverText ? 'yes' : 'no'}`
  )

  if (problems.length) {
    throw new Error(`Kira Noco test target mismatch: ${problems.join(', ')}`)
  }
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

  assertKiraOnlyNocoTestGate(clients)

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
  assertKiraOnlyNocoTestGate,
  isClientReportSuccessful,
  selectClientsByCommonChatIds,
  selectClientsByUniqueNames,
  splitTelegramMessage
}
