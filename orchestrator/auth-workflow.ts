const { closePageQuietly } = require('../browser/page-utils.ts')
const { removeAutoResponderUi } = require('../auto-responder/browser.ts')
const {
  ensureHHAuthOnCurrentPage,
  formatAuthCheckBrief,
  isIndecisiveHhAuthState,
  shouldRunHHAuthFallback,
  waitForScenarioAuthDecision
} = require('../hh-auth/orchestrator.ts')
const { addLifecycleEvent } = require('./reporting.ts')
const { HH_SCENARIO_AUTH_UNKNOWN_RECHECK_MS } = require('./config.ts')

type ClientAutomationData = import('./types.ts').ClientAutomationData
type OpenScenarioResult = import('./types.ts').OpenScenarioResult
type OrchestratorStatus = import('./types.ts').OrchestratorStatus
type HhAuthCheck = import('./types.ts').HhAuthCheck

type ScenarioAuthWorkflowState = {
  pageResult: OpenScenarioResult
  status: OrchestratorStatus
  disposeWatcher?: () => void
}

type ScenarioAuthWorkflowOptions = {
  clientData: ClientAutomationData
  runStartedAt: number
  state: ScenarioAuthWorkflowState
  reopenScenario(
    status: OrchestratorStatus,
    options?: { skipManualVacanciesCleanup?: boolean }
  ): Promise<{
    pageResult: OpenScenarioResult
    status: OrchestratorStatus
  }>
}

type ScenarioAuthWorkflowDependencies = {
  closePageQuietly(page: OpenScenarioResult['page']): Promise<unknown>
  ensureHHAuthOnCurrentPage(
    clientData: ClientAutomationData,
    page: OpenScenarioResult['page']
  ): Promise<HhAuthCheck>
  removeAutoResponderUi(page: OpenScenarioResult['page']): Promise<unknown>
  waitForScenarioAuthDecision(
    page: OpenScenarioResult['page'],
    initialCheck: HhAuthCheck
  ): Promise<{ check: HhAuthCheck; recheckCount: number }>
}

const defaultDependencies: ScenarioAuthWorkflowDependencies = {
  closePageQuietly,
  ensureHHAuthOnCurrentPage,
  removeAutoResponderUi,
  waitForScenarioAuthDecision
}

async function waitForStableAuthState(
  pageResult: OpenScenarioResult,
  status: OrchestratorStatus,
  runStartedAt: number,
  unclearEvent: string,
  recheckEvent: string,
  initialCheck: HhAuthCheck,
  dependencies: ScenarioAuthWorkflowDependencies
): Promise<{ check: HhAuthCheck; status: OrchestratorStatus }> {
  if (!isIndecisiveHhAuthState(initialCheck.state)) {
    return {
      check: initialCheck,
      status
    }
  }

  status = addLifecycleEvent(
    status,
    runStartedAt,
    unclearEvent,
    `${formatAuthCheckBrief(initialCheck)}; timeout ${HH_SCENARIO_AUTH_UNKNOWN_RECHECK_MS}ms`
  )
  const authDecision = await dependencies.waitForScenarioAuthDecision(
    pageResult.page,
    initialCheck
  )
  const check = authDecision.check
  status = {
    ...status,
    authBeforeStart: check
  }
  status = addLifecycleEvent(
    status,
    runStartedAt,
    recheckEvent,
    `${formatAuthCheckBrief(check)}; rechecks ${authDecision.recheckCount}`
  )

  return {
    check,
    status
  }
}

async function ensureScenarioAuthorizedBeforeStart(
  options: ScenarioAuthWorkflowOptions,
  dependencies: ScenarioAuthWorkflowDependencies = defaultDependencies
): Promise<ScenarioAuthWorkflowState> {
  const {
    clientData,
    reopenScenario,
    runStartedAt
  } = options
  let {
    disposeWatcher,
    pageResult,
    status
  } = options.state
  let scenarioAuthBeforeStart = status.authBeforeStart

  if (!scenarioAuthBeforeStart) {
    return {
      disposeWatcher,
      pageResult,
      status
    }
  }

  status = addLifecycleEvent(
    status,
    runStartedAt,
    'HH auth checked before start',
    formatAuthCheckBrief(scenarioAuthBeforeStart)
  )

  let stableAuth = await waitForStableAuthState(
    pageResult,
    status,
    runStartedAt,
    'HH auth state unclear before start; waiting for stable signal',
    'HH auth rechecked before start',
    scenarioAuthBeforeStart,
    dependencies
  )
  scenarioAuthBeforeStart = stableAuth.check
  status = stableAuth.status

  if (
    scenarioAuthBeforeStart.state === 'logged_in' &&
    !pageResult.result.startButtonClicked
  ) {
    disposeWatcher?.()
    disposeWatcher = undefined
    await dependencies.closePageQuietly(pageResult.page)

    status = addLifecycleEvent(
      status,
      runStartedAt,
      'reopening scenario after delayed HH auth signal'
    )
    const reopened = await reopenScenario(status, { skipManualVacanciesCleanup: true })
    pageResult = reopened.pageResult
    status = reopened.status
    disposeWatcher = pageResult.disposeWatcher
    scenarioAuthBeforeStart = status.authBeforeStart

    if (scenarioAuthBeforeStart) {
      stableAuth = await waitForStableAuthState(
        pageResult,
        status,
        runStartedAt,
        'HH auth state unclear after delayed auth reopen; waiting for stable signal',
        'HH auth rechecked before start after delayed auth reopen',
        scenarioAuthBeforeStart,
        dependencies
      )
      scenarioAuthBeforeStart = stableAuth.check
      status = stableAuth.status
    }
  }

  if (!scenarioAuthBeforeStart) {
    throw new Error('HH auth check before auto responder start is missing')
  }

  if (scenarioAuthBeforeStart.state === 'captcha') {
    throw new Error(
      `HH captcha detected before auto responder start: ${formatAuthCheckBrief(scenarioAuthBeforeStart)}`
    )
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
    await dependencies.removeAutoResponderUi(pageResult.page)

    const currentPageAuth = await dependencies.ensureHHAuthOnCurrentPage(
      clientData,
      pageResult.page
    )
    status = addLifecycleEvent(
      status,
      runStartedAt,
      'HH auth ensured',
      formatAuthCheckBrief(currentPageAuth)
    )
    await dependencies.closePageQuietly(pageResult.page)

    status = addLifecycleEvent(
      status,
      runStartedAt,
      'reopening scenario after current-page auth'
    )
    const reopened = await reopenScenario(status, { skipManualVacanciesCleanup: true })
    pageResult = reopened.pageResult
    status = reopened.status
    disposeWatcher = pageResult.disposeWatcher
    scenarioAuthBeforeStart = status.authBeforeStart

    if (scenarioAuthBeforeStart) {
      stableAuth = await waitForStableAuthState(
        pageResult,
        status,
        runStartedAt,
        'HH auth state unclear after current-page auth; waiting for stable signal',
        'HH auth rechecked before start after current-page auth',
        scenarioAuthBeforeStart,
        dependencies
      )
      scenarioAuthBeforeStart = stableAuth.check
      status = stableAuth.status
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

  return {
    disposeWatcher,
    pageResult,
    status
  }
}

module.exports = {
  ensureScenarioAuthorizedBeforeStart,
  waitForStableAuthState
}
