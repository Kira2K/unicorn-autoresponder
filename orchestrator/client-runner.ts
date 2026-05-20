const { closePageQuietly } = require('../browser/page-utils.ts')
const {
  createResponseCounter,
  extractParserErrorCodesFromLogs,
  getAutoResponderParserErrors,
  getAutoResponderRecentUrls,
  getAutoResponderStopReason,
  getAutoResponderSuccessCount,
  getManualVacancies,
  getParserLogs,
  removeAutoResponderUi,
  stopAutoResponder,
  waitForAutoResponderToFinish
} = require('../auto-responder/browser.ts')
const {
  addDolphinProfileTag,
  ensureAutomationLockStatusId,
  getDolphinProfile,
  getDolphinProfileStatusId,
  removeDolphinProfileTag,
  startDolphinProfile,
  stopDolphinProfile,
  updateDolphinProfileStatus
} = require('../dolphin/index.ts')
const {
  detectHhAuthState,
  ensureHHAuthOnCurrentPage,
  formatAuthCheckBrief,
  isIndecisiveHhAuthState,
  shouldRunHHAuthFallback,
  waitForScenarioAuthDecision
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
  getErrorMessage,
  getErrorStack
} = require('./runtime-utils.ts')
const {
  AUTOMATION_LOCK_TAG,
  AUTO_RESPONDER_WATCH_MS,
  DOLPHIN_HEADLESS,
  HH_SCENARIO_AUTH_UNKNOWN_RECHECK_MS
} = require('./config.ts')

type ClientAutomationData = import('./types.ts').ClientAutomationData
type ManualVacancy = import('./types.ts').ManualVacancy
type OrchestratorStatus = import('./types.ts').OrchestratorStatus
type OpenScenarioResult = import('./types.ts').OpenScenarioResult
type ParserErrorEntry = import('./types.ts').ParserErrorEntry
type ParserLogEntry = import('./types.ts').ParserLogEntry
type RecentUrlEntry = import('./types.ts').RecentUrlEntry
type ResponseCounter = import('./types.ts').ResponseCounter

type AutoResponderCollectedData = {
  manualVacancies: ManualVacancy[]
  parserLogs: ParserLogEntry[]
  responseCount: number
  vacancyTransitionCount: number
  parserErrorLogsCount: number
  parserErrorCodes: string[]
  parserLastErrorCode?: string
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
  clientData: ClientAutomationData,
  responseCounter: ResponseCounter,
  runStartedAt: number,
  status: OrchestratorStatus
): Promise<{ status: OrchestratorStatus; pageResult: OpenScenarioResult }> {
  const pageResult = await openScenarioAndInjectIndex(
    port,
    clientData.stackScenario!,
    responseCounter,
    {
      coverText: clientData.coverText,
      blockedCompanies: clientData.blockedCompanies
    }
  )

  return {
    pageResult,
    status: applyManualVacanciesCleanupLifecycle(
      {
        ...status,
        ...pageResult.result
      },
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
        .filter((code): code is string => Boolean(code)),
      ...extractParserErrorCodesFromLogs(parserLogs)
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
    parserLogsCount: parserLogs.length,
    parserErrorLogsCount,
    parserErrorCodes,
    parserLastErrorCode,
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
    `responses ${responseCount}, viewed ${vacancyTransitionCount}, manual ${manualVacancies.length}, parser errors ${parserErrorLogsCount}, parser codes ${parserErrorCodes.join(', ') || 'n/a'}, stop reason ${stopReason?.reason ?? 'n/a'}`
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
  await sendManualVacanciesToTelegram(
    clientData.commonChatId,
    `${clientData.clientName} / ${clientData.market}`,
    data.manualVacancies,
    data.responseCount,
    data.vacancyTransitionCount,
    isClientReportSuccessful(status),
    status.manualVacanciesCleanup
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
      await sendParserLogsToTelegram(status, data.parserLogs)
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
  if (DOLPHIN_HEADLESS) {
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
    startButtonClicked: false
  }
  let disposeWatcher: (() => void) | undefined
  let profileTagAdded = false
  let profileStatusApplied = false
  let previousProfileStatusId: number | null | undefined
  const responseCounter = createResponseCounter()
  status = addLifecycleEvent(status, runStartedAt, 'client run started')

  try {
    const profileLock = await applyAutomationProfileLock(
      clientData,
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

    status = addLifecycleEvent(status, runStartedAt, 'opening scenario')
    let scenarioState = await openClientScenario(
      port,
      clientData,
      responseCounter,
      runStartedAt,
      status
    )
    let pageResult = scenarioState.pageResult
    status = scenarioState.status
    disposeWatcher = pageResult.disposeWatcher
    let scenarioAuthBeforeStart = status.authBeforeStart

    if (scenarioAuthBeforeStart) {
      status = addLifecycleEvent(
        status,
        runStartedAt,
        'HH auth checked before start',
        formatAuthCheckBrief(scenarioAuthBeforeStart)
      )

      if (isIndecisiveHhAuthState(scenarioAuthBeforeStart.state)) {
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'HH auth state unclear before start; waiting for stable signal',
          `${formatAuthCheckBrief(scenarioAuthBeforeStart)}; timeout ${HH_SCENARIO_AUTH_UNKNOWN_RECHECK_MS}ms`
        )
        const authDecision = await waitForScenarioAuthDecision(
          pageResult.page,
          scenarioAuthBeforeStart
        )
        scenarioAuthBeforeStart = authDecision.check
        status = {
          ...status,
          authBeforeStart: scenarioAuthBeforeStart
        }
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'HH auth rechecked before start',
          `${formatAuthCheckBrief(scenarioAuthBeforeStart)}; rechecks ${authDecision.recheckCount}`
        )
      }

      if (
        scenarioAuthBeforeStart &&
        scenarioAuthBeforeStart.state === 'logged_in' &&
        !pageResult.result.startButtonClicked
      ) {
        disposeWatcher?.()
        disposeWatcher = undefined
        await closePageQuietly(pageResult.page)

        status = addLifecycleEvent(
          status,
          runStartedAt,
          'reopening scenario after delayed HH auth signal'
        )
        scenarioState = await openClientScenario(
          port,
          clientData,
          responseCounter,
          runStartedAt,
          status
        )
        pageResult = scenarioState.pageResult
        status = scenarioState.status
        disposeWatcher = pageResult.disposeWatcher
        scenarioAuthBeforeStart = status.authBeforeStart

        if (
          scenarioAuthBeforeStart &&
          isIndecisiveHhAuthState(scenarioAuthBeforeStart.state)
        ) {
          status = addLifecycleEvent(
            status,
            runStartedAt,
            'HH auth state unclear after delayed auth reopen; waiting for stable signal',
            `${formatAuthCheckBrief(scenarioAuthBeforeStart)}; timeout ${HH_SCENARIO_AUTH_UNKNOWN_RECHECK_MS}ms`
          )
          const authDecision = await waitForScenarioAuthDecision(
            pageResult.page,
            scenarioAuthBeforeStart
          )
          scenarioAuthBeforeStart = authDecision.check
          status = {
            ...status,
            authBeforeStart: scenarioAuthBeforeStart
          }
          status = addLifecycleEvent(
            status,
            runStartedAt,
            'HH auth rechecked before start after delayed auth reopen',
            `${formatAuthCheckBrief(scenarioAuthBeforeStart)}; rechecks ${authDecision.recheckCount}`
          )
        }
      }

      if (!scenarioAuthBeforeStart) {
        throw new Error('HH auth check before auto responder start is missing')
      }

      if (shouldRunHHAuthFallback(scenarioAuthBeforeStart.state)) {
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'HH auth missing on scenario; logging in on current page',
          formatAuthCheckBrief(scenarioAuthBeforeStart)
        )
        disposeWatcher?.()
        disposeWatcher = undefined
        await removeAutoResponderUi(pageResult.page)

        const currentPageAuth = await ensureHHAuthOnCurrentPage(
          clientData,
          pageResult.page
        )
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'HH auth ensured',
          formatAuthCheckBrief(currentPageAuth)
        )
        await closePageQuietly(pageResult.page)

        status = addLifecycleEvent(
          status,
          runStartedAt,
          'reopening scenario after current-page auth'
        )
        scenarioState = await openClientScenario(
          port,
          clientData,
          responseCounter,
          runStartedAt,
          status
        )
        pageResult = scenarioState.pageResult
        status = scenarioState.status
        disposeWatcher = pageResult.disposeWatcher
        scenarioAuthBeforeStart = status.authBeforeStart
        if (
          scenarioAuthBeforeStart &&
          isIndecisiveHhAuthState(scenarioAuthBeforeStart.state)
        ) {
          status = addLifecycleEvent(
            status,
            runStartedAt,
            'HH auth state unclear after current-page auth; waiting for stable signal',
            `${formatAuthCheckBrief(scenarioAuthBeforeStart)}; timeout ${HH_SCENARIO_AUTH_UNKNOWN_RECHECK_MS}ms`
          )
          const authDecision = await waitForScenarioAuthDecision(
            pageResult.page,
            scenarioAuthBeforeStart
          )
          scenarioAuthBeforeStart = authDecision.check
          status = {
            ...status,
            authBeforeStart: scenarioAuthBeforeStart
          }
          status = addLifecycleEvent(
            status,
            runStartedAt,
            'HH auth rechecked before start after current-page auth',
            `${formatAuthCheckBrief(scenarioAuthBeforeStart)}; rechecks ${authDecision.recheckCount}`
          )
        }
        if (!scenarioAuthBeforeStart || scenarioAuthBeforeStart.state !== 'logged_in') {
          throw new Error(
            `HH auth check before auto responder start failed after current-page auth: ${
              scenarioAuthBeforeStart
                ? formatAuthCheckBrief(scenarioAuthBeforeStart)
                : 'missing auth check'
            }`
          )
        }
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'HH auth checked before start after current-page auth',
          formatAuthCheckBrief(scenarioAuthBeforeStart)
        )
      } else if (scenarioAuthBeforeStart.state !== 'logged_in') {
        throw new Error(
          `HH auth state before auto responder start stayed ${scenarioAuthBeforeStart.state}; ` +
            `not running current-page auth without logged_out/captcha signal: ` +
            formatAuthCheckBrief(scenarioAuthBeforeStart)
        )
      }
    }
    status = addLifecycleEvent(
      status,
      runStartedAt,
      status.startButtonClicked
        ? 'auto responder started'
        : 'scenario opened without start',
      pageResult.result.pageUrl
    )

    if (status.startButtonClicked) {
      const autoResponderResult = await waitForAutoResponderToFinish(
        pageResult.page,
        AUTO_RESPONDER_WATCH_MS,
        pageResult.isBrowserDisconnected
      )

      status = {
        ...status,
        autoResponderFinished: autoResponderResult.finished,
        autoResponderWatchTimedOut: autoResponderResult.timedOut
      }
      status = addLifecycleEvent(
        status,
        runStartedAt,
        autoResponderResult.finished
          ? 'auto responder finished itself'
          : 'auto responder watch timeout'
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

      try {
        const collected = await collectAutoResponderRunData(
          pageResult,
          responseCounter,
          status,
          runStartedAt
        )
        status = collected.status
        status = await sendClientAutoResponderReports(
          clientData,
          status,
          runStartedAt,
          collected.data
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
  writeLocalRunLog({
    kind: 'client-final-status',
    status
  })
  await sendClientLifecycleLog(status)
  await sendClientErrorLog(status)

  console.log(status)

  return status
}


module.exports = {
  runClientOrchestrator
}
