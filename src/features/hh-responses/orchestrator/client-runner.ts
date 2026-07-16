const {
  createResponseCounter,
  extractParserErrorCodesFromLogs,
  getAutoResponderParserErrors,
  getAutoResponderRecentUrls,
  getAutoResponderRecoverableVacancyFailureCount,
  getAutoResponderStopReason,
  getAutoResponderSuccessCount,
  getManualVacancies,
  getParserLogs,
  stopAutoResponder,
  waitForAutoResponderToFinish
} = require('../auto-responder/browser.ts')
const { closePageQuietly } = require('../../../platform/browser/page-utils.ts')
const {
  addDolphinProfileTag,
  ensureAutomationLockStatusId,
  getDolphinProfile,
  getDolphinProfileStatusId,
  removeDolphinProfileTag,
  startDolphinProfile,
  stopDolphinProfile,
  updateDolphinProfileStatus
} = require('../../../integrations/dolphin/index.ts')
const {
  detectHhAuthState,
  formatAuthCheckBrief
} = require('../hh-auth/orchestrator.ts')
const {
  addLifecycleEvent,
  formatManualVacanciesCleanupBrief,
  isAutoResponderStopNormal,
  isClientReportSuccessful,
  sendClientErrorLog,
  sendClientLifecycleLog,
  sendManualVacanciesToTelegram,
  sendParserLogsToTelegram,
  shouldCheckAuthAfterParserStop,
  shouldSendParserLogsToTelegram,
  writeLocalRunLog
} = require('./reporting.ts')
const { openScenarioAndInjectIndex } = require('./scenario-runner.ts')
const {
  ensureScenarioAuthorizedBeforeStart
} = require('./auth-workflow.ts')
const {
  getErrorMessage,
  getErrorStack,
  withTimeout
} = require('./runtime-utils.ts')
const {
  applyResponseRequirementStatus,
  normalizeParserErrorCode,
  summarizeManualBlockers
} = require('./scraper-state.ts')
const {
  getAutoReloadRecoveryReason
} = require('./recovery.ts')
const {
  AUTOMATION_LOCK_TAG,
  AUTO_RESPONDER_WATCH_MS,
  DOLPHIN_KEEP_PROFILE_OPEN_AFTER_RUN,
  ORCHESTRATOR_IDLE_TIMEOUT_MS,
  ORCHESTRATOR_CLIENT_REPORT_TIMEOUT_MS,
  ORCHESTRATOR_RESPONSE_LIMIT
} = require('./config.ts')

type ClientAutomationData = import('./types.ts').ClientAutomationData
type LifecycleEvent = import('./types.ts').LifecycleEvent
type ManualVacancy = import('./types.ts').ManualVacancy
type OrchestratorStatus = import('./types.ts').OrchestratorStatus
type OpenScenarioResult = import('./types.ts').OpenScenarioResult
type ParserErrorEntry = import('./types.ts').ParserErrorEntry
type ParserLogEntry = import('./types.ts').ParserLogEntry
type RecentUrlEntry = import('./types.ts').RecentUrlEntry
type ResponseCounter = import('./types.ts').ResponseCounter
type RunnableClientAutomationData =
  import('./types.ts').RunnableClientAutomationData

type AutoResponderCollectedData = {
  manualVacancies: ManualVacancy[]
  parserLogs: ParserLogEntry[]
  responseCount: number
  vacancyTransitionCount: number
  parserErrorLogsCount: number
  parserErrorCodes: string[]
  parserLastErrorCode?: string
}

type OpenClientScenarioOptions = {
  skipManualVacanciesCleanup?: boolean
}

function applyManualVacanciesCleanupLifecycle(
  status: OrchestratorStatus,
  runStartedAt: number
): OrchestratorStatus {
  if (!status.manualVacanciesCleanup) {
    return status
  }

  return addLifecycleEvent(
    status,
    runStartedAt,
    status.manualVacanciesCleanup.skipped
      ? 'manual vacancies cleanup skipped'
      : status.manualVacanciesCleanup.completed
        ? 'manual vacancies cleanup completed'
        : 'manual vacancies cleanup kept pending entries',
    formatManualVacanciesCleanupBrief(status.manualVacanciesCleanup)
  )
}

async function openClientScenario(
  port: number,
  clientData: RunnableClientAutomationData,
  responseCounter: ResponseCounter,
  runStartedAt: number,
  status: OrchestratorStatus,
  options: OpenClientScenarioOptions = {}
): Promise<{ status: OrchestratorStatus; pageResult: OpenScenarioResult }> {
  const scenarioLifecycleEvents: LifecycleEvent[] = []
  const logScenarioLifecycleEvent = (event: string, details?: string): void => {
    const lifecycleEvent = {
      at: new Date().toISOString(),
      elapsedMs: Date.now() - runStartedAt,
      event,
      details
    }
    scenarioLifecycleEvents.push(lifecycleEvent)
    writeLocalRunLog({
      kind: 'client-lifecycle',
      clientName: status.clientName,
      market: status.market,
      stack: status.stack,
      dolphinProfileId: status.dolphinProfileId,
      event: lifecycleEvent
    })
  }
  const pageResult = await openScenarioAndInjectIndex(
    port,
    clientData.stackScenario,
    responseCounter,
    {
      coverText: clientData.coverText,
      blockedCompanies: clientData.blockedCompanies,
      responseLimit: ORCHESTRATOR_RESPONSE_LIMIT,
      skipManualVacanciesCleanup: options.skipManualVacanciesCleanup,
      logLifecycleEvent: logScenarioLifecycleEvent
    }
  )
  const nextStatus = {
    ...status,
    ...pageResult.result,
    lifecycleEvents: [
      ...status.lifecycleEvents,
      ...scenarioLifecycleEvents
    ],
    manualVacanciesCleanup:
      options.skipManualVacanciesCleanup && status.manualVacanciesCleanup
        ? status.manualVacanciesCleanup
        : pageResult.result.manualVacanciesCleanup
  }

  return {
    pageResult,
    status: applyManualVacanciesCleanupLifecycle(
      nextStatus,
      runStartedAt
    )
  }
}

async function applyAutomationProfileLock(
  clientData: ClientAutomationData,
  status: OrchestratorStatus,
  runStartedAt: number
): Promise<{
  status: OrchestratorStatus
  previousProfileStatusId: number | null | undefined
}> {
  status = addLifecycleEvent(
    status,
    runStartedAt,
    'applying automation profile lock'
  )
  const automationStatusId = await ensureAutomationLockStatusId()
  const profileBeforeLock = await getDolphinProfile(clientData.dolphinProfileId)
  const currentProfileStatusId = getDolphinProfileStatusId(profileBeforeLock)
  const previousProfileStatusId =
    currentProfileStatusId === automationStatusId
      ? null
      : currentProfileStatusId

  await addDolphinProfileTag(clientData.dolphinProfileId, AUTOMATION_LOCK_TAG)
  await updateDolphinProfileStatus(
    clientData.dolphinProfileId,
    automationStatusId
  )
  status = {
    ...status,
    profileTagAdded: true,
    profileTagVerifiedAfterAdd: true,
    profileStatusApplied: true
  }
  status = addLifecycleEvent(
    status,
    runStartedAt,
    'automation profile lock verified',
    `status ${automationStatusId}, previous ${String(previousProfileStatusId)}`
  )

  return {
    status,
    previousProfileStatusId
  }
}

async function startDolphinForClient(
  clientData: ClientAutomationData,
  status: OrchestratorStatus,
  runStartedAt: number
): Promise<{ status: OrchestratorStatus; port: number }> {
  status = addLifecycleEvent(status, runStartedAt, 'starting Dolphin profile')
  const startResponse = await startDolphinProfile(clientData.dolphinProfileId)
  const port = startResponse.automation?.port

  if (!port) {
    throw new Error('Dolphin did not return an automation port')
  }

  return {
    port,
    status: addLifecycleEvent(
      status,
      runStartedAt,
      'Dolphin profile started',
      `port ${port}`
    )
  }
}

async function collectAutoResponderRunData(
  pageResult: OpenScenarioResult,
  responseCounter: ResponseCounter,
  status: OrchestratorStatus,
  runStartedAt: number
): Promise<{ status: OrchestratorStatus; data: AutoResponderCollectedData }> {
  status = addLifecycleEvent(status, runStartedAt, 'stopping auto responder')
  const stopButtonClicked = await stopAutoResponder(pageResult.page)
  const stopReason = await getAutoResponderStopReason(pageResult.page)
  const manualVacancies: ManualVacancy[] = await getManualVacancies(
    pageResult.page
  )
  const responseCount = await getAutoResponderSuccessCount(pageResult.page)
  const recoverableVacancyFailureCount =
    await getAutoResponderRecoverableVacancyFailureCount(pageResult.page)
  const parserLogs: ParserLogEntry[] = await getParserLogs(pageResult.page)
  const structuredParserErrors: ParserErrorEntry[] =
    await getAutoResponderParserErrors(pageResult.page)
  const storedRecentUrls: RecentUrlEntry[] = await getAutoResponderRecentUrls(
    pageResult.page
  )
  const recentUrls = storedRecentUrls.length
    ? storedRecentUrls
    : (stopReason?.recentUrls ?? [])
  const parserErrorLogsCount = parserLogs.filter(entry => entry.isError).length
  const parserErrorCodes = [
    ...new Set([
      ...structuredParserErrors
        .map(entry => entry.code)
        .filter((code): code is string => Boolean(code))
        .map(code => normalizeParserErrorCode(code).code),
      ...extractParserErrorCodesFromLogs(parserLogs)
        .map((code: string) => normalizeParserErrorCode(code).code)
    ])
  ]
  const parserLastErrorCode =
    structuredParserErrors
      .map(entry => entry.code)
      .filter((code): code is string => Boolean(code))
      .at(-1) ?? parserErrorCodes.at(-1)
  const vacancyTransitionCount = responseCounter.vacancyIds.size

  status = {
    ...status,
    stopButtonClicked,
    autoResponderStopReason: stopReason?.reason,
    autoResponderStopReasonDetails: stopReason?.details,
    responseCount,
    vacancyTransitionCount,
    manualVacanciesCount: manualVacancies.length,
    manualBlockerSummary: summarizeManualBlockers({
      manualVacancies,
      manualVacanciesCount: manualVacancies.length,
      stopReasonDetails: stopReason?.details
    }),
    parserLogsCount: parserLogs.length,
    parserErrorLogsCount,
    parserErrorCodes,
    parserLastErrorCode,
    recoverableVacancyFailureCount,
    recentUrls
  }

  if (shouldCheckAuthAfterParserStop(status)) {
    const authAfterParserStop = await detectHhAuthState(pageResult.page)
    status = {
      ...status,
      authAfterParserStop
    }
    status = addLifecycleEvent(
      status,
      runStartedAt,
      'HH auth checked after parser stop',
      formatAuthCheckBrief(authAfterParserStop)
    )
  }

  status = addLifecycleEvent(
    status,
    runStartedAt,
    'auto responder data collected',
    `responses ${responseCount}, viewed ${vacancyTransitionCount}, manual ${manualVacancies.length}, recoverable vacancy skips ${recoverableVacancyFailureCount}, parser errors ${parserErrorLogsCount}, parser codes ${parserErrorCodes.join(', ') || 'n/a'}, stop reason ${stopReason?.reason ?? 'n/a'}`
  )

  return {
    status,
    data: {
      manualVacancies,
      parserLogs,
      responseCount,
      vacancyTransitionCount,
      parserErrorLogsCount,
      parserErrorCodes,
      parserLastErrorCode
    }
  }
}

function shouldAttemptAutoReloadRecovery(
  status: OrchestratorStatus,
  error?: unknown
): string | undefined {
  return getAutoReloadRecoveryReason({ status, error })
}

async function disposeScenarioForRecovery(
  pageResult: OpenScenarioResult | undefined,
  disposeWatcher: (() => void) | undefined
): Promise<void> {
  disposeWatcher?.()

  if (pageResult) {
    await closePageQuietly(pageResult.page)
  }
}

async function sendClientAutoResponderReports(
  clientData: ClientAutomationData,
  status: OrchestratorStatus,
  runStartedAt: number,
  data: AutoResponderCollectedData
): Promise<OrchestratorStatus> {
  status = addLifecycleEvent(
    status,
    runStartedAt,
    'sending client Telegram report'
  )
  await withTimeout(
    sendManualVacanciesToTelegram(
      clientData.commonChatId,
      `${clientData.clientName} / ${clientData.market}`,
      data.manualVacancies,
      data.responseCount,
      data.vacancyTransitionCount,
      isClientReportSuccessful(status),
      status.manualVacanciesCleanup
    ),
    ORCHESTRATOR_CLIENT_REPORT_TIMEOUT_MS,
    `Client Telegram report timed out after ${ORCHESTRATOR_CLIENT_REPORT_TIMEOUT_MS}ms`
  )

  status = {
    ...status,
    manualVacanciesSent: true
  }
  status = addLifecycleEvent(
    status,
    runStartedAt,
    'client Telegram report sent'
  )

  try {
    if (shouldSendParserLogsToTelegram(status, data.parserLogs)) {
      status = addLifecycleEvent(
        status,
        runStartedAt,
        'sending parser logs to logs chat'
      )
      await withTimeout(
        sendParserLogsToTelegram(status, data.parserLogs),
        ORCHESTRATOR_CLIENT_REPORT_TIMEOUT_MS,
        `Parser logs Telegram report timed out after ${ORCHESTRATOR_CLIENT_REPORT_TIMEOUT_MS}ms`
      )
      status = {
        ...status,
        parserLogsSent: true
      }
      status = addLifecycleEvent(
        status,
        runStartedAt,
        'parser logs sent to logs chat'
      )
    } else {
      status = {
        ...status,
        parserLogsSent: false
      }
      status = addLifecycleEvent(
        status,
        runStartedAt,
        'parser logs skipped',
        isAutoResponderStopNormal(status)
          ? 'normal auto responder stop'
          : 'no parser logs'
      )
    }
  } catch (error: unknown) {
    status = {
      ...status,
      parserLogsSent: false
    }
    status = addLifecycleEvent(
      status,
      runStartedAt,
      'parser logs sending failed',
      getErrorMessage(error)
    )
    console.error(
      `Failed to send parser logs to Telegram: ${getErrorMessage(error)}`
    )
  }

  return status
}

async function sendClientFinalTelegramLogsWithTimeout(
  status: OrchestratorStatus
): Promise<void> {
  try {
    await withTimeout(
      sendClientLifecycleLog(status),
      ORCHESTRATOR_CLIENT_REPORT_TIMEOUT_MS,
      `Client lifecycle Telegram log timed out after ${ORCHESTRATOR_CLIENT_REPORT_TIMEOUT_MS}ms`
    )
  } catch (error: unknown) {
    console.error(
      `Failed to send client lifecycle log: ${getErrorMessage(error)}`
    )
    writeLocalRunLog({
      kind: 'client-lifecycle-send-failed',
      clientName: status.clientName,
      market: status.market,
      dolphinProfileId: status.dolphinProfileId,
      timeoutMs: ORCHESTRATOR_CLIENT_REPORT_TIMEOUT_MS,
      error: getErrorMessage(error),
      errorStack: getErrorStack(error)
    })
  }

  try {
    await withTimeout(
      sendClientErrorLog(status),
      ORCHESTRATOR_CLIENT_REPORT_TIMEOUT_MS,
      `Client error Telegram log timed out after ${ORCHESTRATOR_CLIENT_REPORT_TIMEOUT_MS}ms`
    )
  } catch (error: unknown) {
    console.error(`Failed to send client error log: ${getErrorMessage(error)}`)
    writeLocalRunLog({
      kind: 'client-error-send-failed',
      clientName: status.clientName,
      market: status.market,
      dolphinProfileId: status.dolphinProfileId,
      timeoutMs: ORCHESTRATOR_CLIENT_REPORT_TIMEOUT_MS,
      error: getErrorMessage(error),
      errorStack: getErrorStack(error)
    })
  }
}

async function cleanupClientDolphinProfile(
  clientData: ClientAutomationData,
  status: OrchestratorStatus,
  runStartedAt: number,
  options: {
    profileTagAdded: boolean
    profileStatusApplied: boolean
    previousProfileStatusId: number | null | undefined
  }
): Promise<OrchestratorStatus> {
  if (!DOLPHIN_KEEP_PROFILE_OPEN_AFTER_RUN) {
    try {
      status = addLifecycleEvent(
        status,
        runStartedAt,
        'stopping Dolphin profile'
      )
      await stopDolphinProfile(clientData.dolphinProfileId)
      status = {
        ...status,
        profileStopped: true
      }
      status = addLifecycleEvent(
        status,
        runStartedAt,
        'Dolphin profile stopped'
      )
    } catch (error: unknown) {
      status = {
        ...status,
        profileStopped: false,
        error: status.error ?? getErrorMessage(error),
        errorStack: status.errorStack ?? getErrorStack(error)
      }
    }
  } else {
    status = addLifecycleEvent(
      status,
      runStartedAt,
      'Dolphin profile left open by DOLPHIN_KEEP_PROFILE_OPEN_AFTER_RUN'
    )
  }

  if (options.profileTagAdded) {
    try {
      status = addLifecycleEvent(
        status,
        runStartedAt,
        'removing automation tag'
      )
      await removeDolphinProfileTag(
        clientData.dolphinProfileId,
        AUTOMATION_LOCK_TAG
      )
      status = {
        ...status,
        profileTagRemoved: true,
        profileTagVerifiedAfterRemove: true
      }
      status = addLifecycleEvent(
        status,
        runStartedAt,
        'automation tag removal verified'
      )
    } catch (error: unknown) {
      status = {
        ...status,
        profileTagRemoved: false,
        error: status.error ?? getErrorMessage(error),
        errorStack: status.errorStack ?? getErrorStack(error)
      }
    }
  }

  if (options.profileStatusApplied) {
    try {
      status = addLifecycleEvent(
        status,
        runStartedAt,
        'restoring previous Dolphin status'
      )
      await updateDolphinProfileStatus(
        clientData.dolphinProfileId,
        options.previousProfileStatusId ?? null
      )
      status = {
        ...status,
        profileStatusRestored: true
      }
      status = addLifecycleEvent(
        status,
        runStartedAt,
        'previous Dolphin status restored'
      )
    } catch (error: unknown) {
      status = {
        ...status,
        profileStatusRestored: false,
        error: status.error ?? getErrorMessage(error),
        errorStack: status.errorStack ?? getErrorStack(error)
      }
    }
  }

  return status
}

async function runClientOrchestrator(
  clientData: ClientAutomationData
): Promise<OrchestratorStatus> {
  if (!clientData.stackScenario) {
    throw new Error(`Stack scenario for ${clientData.clientName} was not found`)
  }
  const runnableClientData: RunnableClientAutomationData = {
    ...clientData,
    stackScenario: clientData.stackScenario
  }

  const runStartedAt = Date.now()
  let status: OrchestratorStatus = {
    clientName: clientData.clientName,
    stack: clientData.stack,
    market: clientData.market,
    dolphinProfileId: clientData.dolphinProfileId,
    commonChatId: clientData.commonChatId,
    stackScenario: clientData.stackScenario,
    lifecycleEvents: [],
    opened: false,
    indexScriptInjected: false,
    watcherInstalled: false,
    startButtonClicked: false,
    requiredResponseLimit: ORCHESTRATOR_RESPONSE_LIMIT,
    metResponseLimit: false,
    completionGap: 'not_finished',
    responsesRemaining: ORCHESTRATOR_RESPONSE_LIMIT,
    responseLimitWatchMs: AUTO_RESPONDER_WATCH_MS
  }
  let disposeWatcher: (() => void) | undefined
  let pageResult: OpenScenarioResult | undefined
  let profileTagAdded = false
  let profileStatusApplied = false
  let previousProfileStatusId: number | null | undefined
  const responseCounter = createResponseCounter()
  status = addLifecycleEvent(status, runStartedAt, 'client run started')

  try {
    const profileLock = await applyAutomationProfileLock(
      runnableClientData,
      status,
      runStartedAt
    )
    status = profileLock.status
    previousProfileStatusId = profileLock.previousProfileStatusId
    profileTagAdded = true
    profileStatusApplied = true

    const startedDolphin = await startDolphinForClient(
      clientData,
      status,
      runStartedAt
    )
    status = startedDolphin.status
    const port = startedDolphin.port

    const openAndAuthorizeScenario = async (
      currentStatus: OrchestratorStatus,
      skipManualVacanciesCleanup = false
    ): Promise<OrchestratorStatus> => {
      let nextStatus = addLifecycleEvent(
        currentStatus,
        runStartedAt,
        skipManualVacanciesCleanup
          ? 'reopening scenario after auto reload recovery'
          : 'opening scenario'
      )
      const scenarioState = await openClientScenario(
        port,
        runnableClientData,
        responseCounter,
        runStartedAt,
        nextStatus,
        { skipManualVacanciesCleanup }
      )

      pageResult = scenarioState.pageResult
      nextStatus = scenarioState.status
      disposeWatcher = pageResult.disposeWatcher

      const authWorkflowState = await ensureScenarioAuthorizedBeforeStart({
        clientData,
        runStartedAt,
        state: {
          disposeWatcher,
          pageResult,
          status: nextStatus
        },
        reopenScenario: async (
          currentStatusForReopen: OrchestratorStatus,
          options?: OpenClientScenarioOptions
        ) => {
          return await openClientScenario(
            port,
            runnableClientData,
            responseCounter,
            runStartedAt,
            currentStatusForReopen,
            options
          )
        }
      })

      pageResult = authWorkflowState.pageResult
      nextStatus = authWorkflowState.status
      disposeWatcher = authWorkflowState.disposeWatcher

      if (!pageResult) {
        throw new Error('Scenario open finished without a page result')
      }

      const openedPageResult = pageResult

      return addLifecycleEvent(
        nextStatus,
        runStartedAt,
        nextStatus.startButtonClicked
          ? 'auto responder started'
          : 'scenario opened without start',
        openedPageResult.result.pageUrl
      )
    }

    const runAutoResponderCycle = async (
      currentStatus: OrchestratorStatus
    ): Promise<{
      status: OrchestratorStatus
      data?: AutoResponderCollectedData
    }> => {
      if (!pageResult || !currentStatus.startButtonClicked) {
        return { status: currentStatus }
      }

      const autoResponderResult = await waitForAutoResponderToFinish(
        pageResult.page,
        AUTO_RESPONDER_WATCH_MS,
        pageResult.isBrowserDisconnected,
        ORCHESTRATOR_IDLE_TIMEOUT_MS
      )

      let nextStatus = {
        ...currentStatus,
        autoResponderFinished: autoResponderResult.finished,
        autoResponderWatchTimedOut: autoResponderResult.timedOut,
        autoResponderIdleTimedOut: autoResponderResult.idleTimedOut,
        autoResponderIdleTimeoutMs: autoResponderResult.idleTimeoutMs,
        autoResponderLastProgress: autoResponderResult.lastProgress
      }
      nextStatus = addLifecycleEvent(
        nextStatus,
        runStartedAt,
        autoResponderResult.idleTimedOut
          ? 'auto responder idle timeout'
          : autoResponderResult.finished
          ? 'auto responder finished itself'
          : 'auto responder watch timeout',
        autoResponderResult.idleTimedOut
          ? autoResponderResult.lastProgress
          : undefined
      )

      if (
        autoResponderResult.browserDisconnected ||
        autoResponderResult.pageClosed
      ) {
        throw new Error(
          autoResponderResult.browserDisconnected
            ? 'Browser CDP connection was closed while auto responder was running'
            : 'Page was closed while auto responder was running'
        )
      }

      const collected = await collectAutoResponderRunData(
        pageResult,
        responseCounter,
        nextStatus,
        runStartedAt
      )

      return {
        status: collected.status,
        data: collected.data
      }
    }

    try {
      status = await openAndAuthorizeScenario(status)
    } catch (error: unknown) {
      const recoveryReason = shouldAttemptAutoReloadRecovery(status, error)

      if (!recoveryReason) {
        throw error
      }

      status = {
        ...status,
        autoReloadRecoveryAttempted: true,
        autoReloadRecoveryReason: recoveryReason
      }
      status = addLifecycleEvent(
        status,
        runStartedAt,
        'auto reload recovery attempted',
        recoveryReason
      )
      await disposeScenarioForRecovery(pageResult, disposeWatcher)
      pageResult = undefined
      disposeWatcher = undefined

      try {
        status = await openAndAuthorizeScenario(status, true)
        status = {
          ...status,
          autoReloadRecoverySucceeded: true
        }
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'auto reload recovery succeeded',
          recoveryReason
        )
      } catch (recoveryError: unknown) {
        status = {
          ...status,
          autoReloadRecoverySucceeded: false
        }
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'auto reload recovery failed',
          getErrorMessage(recoveryError)
        )
        throw recoveryError
      }
    }

    let collectedData: AutoResponderCollectedData | undefined

    if (status.startButtonClicked) {
      const cycle = await runAutoResponderCycle(status)
      status = cycle.status
      collectedData = cycle.data

      const recoveryReason = shouldAttemptAutoReloadRecovery(status)

      if (recoveryReason) {
        status = {
          ...status,
          autoReloadRecoveryAttempted: true,
          autoReloadRecoveryReason: recoveryReason
        }
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'auto reload recovery attempted',
          recoveryReason
        )
        await disposeScenarioForRecovery(pageResult, disposeWatcher)
        pageResult = undefined
        disposeWatcher = undefined

        try {
          status = await openAndAuthorizeScenario(status, true)
          const retryCycle = await runAutoResponderCycle(status)
          status = {
            ...retryCycle.status,
            autoReloadRecoverySucceeded: true
          }
          collectedData = retryCycle.data
          status = addLifecycleEvent(
            status,
            runStartedAt,
            'auto reload recovery succeeded',
            recoveryReason
          )
        } catch (recoveryError: unknown) {
          status = {
            ...status,
            autoReloadRecoverySucceeded: false
          }
          status = addLifecycleEvent(
            status,
            runStartedAt,
            'auto reload recovery failed',
            getErrorMessage(recoveryError)
          )
          throw recoveryError
        }
      }

      if (collectedData) {
        try {
          status = await sendClientAutoResponderReports(
            clientData,
            status,
            runStartedAt,
            collectedData
          )
        } catch (error: unknown) {
          status = {
            ...status,
            manualVacanciesSent: false,
            telegramError: getErrorMessage(error),
            errorStack: status.errorStack ?? getErrorStack(error)
          }
        }
      }
    }
  } catch (error: unknown) {
    status = {
      ...status,
      error: getErrorMessage(error),
      errorStack: getErrorStack(error)
    }
  } finally {
    disposeWatcher?.()

    status = await cleanupClientDolphinProfile(
      clientData,
      status,
      runStartedAt,
      {
        profileTagAdded,
        profileStatusApplied,
        previousProfileStatusId
      }
    )
  }

  status = addLifecycleEvent(status, runStartedAt, 'client run finished')
  status = applyResponseRequirementStatus({
    ...status,
    responseLimitElapsedMs: Date.now() - runStartedAt,
    responseLimitTimeLeftMs:
      AUTO_RESPONDER_WATCH_MS === undefined
        ? undefined
        : Math.max(AUTO_RESPONDER_WATCH_MS - (Date.now() - runStartedAt), 0)
  })
  writeLocalRunLog({
    kind: 'client-final-status',
    status
  })
  await sendClientFinalTelegramLogsWithTimeout(status)

  console.log(status)

  return status
}


module.exports = {
  runClientOrchestrator,
  shouldAttemptAutoReloadRecovery
}
