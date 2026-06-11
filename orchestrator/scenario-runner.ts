const fs = require('node:fs/promises')

const { loadPlaywright } = require('../browser/playwright.ts')
const { closePageQuietly } = require('../browser/page-utils.ts')
const {
  applyAutoResponderSettings,
  ensureIndexScript,
  installIndexReinjectWatcher,
  recordVacancyTransition
} = require('../auto-responder/browser.ts')
const {
  createCompanyStopListBrowserSource
} = require('../shared/company-stop-list.ts') as {
  createCompanyStopListBrowserSource(): string
}
const { detectHhAuthState } = require('../hh-auth/orchestrator.ts')
const { runManualVacanciesCleanup } = require('../manual-vacancies-cleanup.ts')
const { isAutoResponderUrl } = require('../shared/hh-url.ts')
const { getErrorMessage, withTimeout } = require('./runtime-utils.ts')
const {
  CONNECT_OVER_CDP_TIMEOUT_MS,
  HH_AUTO_RESPONDER_LOGS_KEY,
  HH_AUTO_RESPONDER_PARSER_ERRORS_KEY,
  HH_AUTO_RESPONDER_RECENT_URLS_KEY,
  HH_AUTO_RESPONDER_RUNNING_KEY,
  HH_AUTO_RESPONDER_STOP_REASON_KEY,
  HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSE_IDS_KEY,
  HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSES_KEY,
  HH_SCENARIO_EARLY_AUTH_CHECK_MS,
  HH_INITIAL_NAVIGATION_TIMEOUT_MS,
  INDEX_SCRIPT_PATH
} = require('./config.ts')

type ManualVacanciesCleanupResult =
  import('./types.ts').ManualVacanciesCleanupResult
type OpenScenarioResult = import('./types.ts').OpenScenarioResult
type ResponseCounter = import('./types.ts').ResponseCounter
type HhAuthCheck = import('./types.ts').HhAuthCheck

type ScenarioLifecycleLog = (event: string, details?: string) => void

type ScenarioRunnerDependencies = {
  applyAutoResponderSettings: typeof applyAutoResponderSettings
  closePageQuietly: typeof closePageQuietly
  createCompanyStopListBrowserSource: typeof createCompanyStopListBrowserSource
  detectHhAuthState: typeof detectHhAuthState
  ensureIndexScript: typeof ensureIndexScript
  installIndexReinjectWatcher: typeof installIndexReinjectWatcher
  loadPlaywright: typeof loadPlaywright
  readFile: typeof fs.readFile
  recordVacancyTransition: typeof recordVacancyTransition
  runManualVacanciesCleanup: typeof runManualVacanciesCleanup
  withTimeout: typeof withTimeout
}

const defaultDependencies: ScenarioRunnerDependencies = {
  applyAutoResponderSettings,
  closePageQuietly,
  createCompanyStopListBrowserSource,
  detectHhAuthState,
  ensureIndexScript,
  installIndexReinjectWatcher,
  loadPlaywright,
  readFile: fs.readFile,
  recordVacancyTransition,
  runManualVacanciesCleanup,
  withTimeout
}

async function openScenarioAndInjectIndex(
  port: number,
  stackScenario: string,
  responseCounter: ResponseCounter,
  options: {
    coverText?: string
    blockedCompanies?: Array<{ id: string; name: string }>
    responseLimit?: number
    skipManualVacanciesCleanup?: boolean
    logLifecycleEvent?: ScenarioLifecycleLog
  } = {},
  dependencies: ScenarioRunnerDependencies = defaultDependencies
): Promise<OpenScenarioResult> {
  const { chromium } = dependencies.loadPlaywright()
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
    timeout: CONNECT_OVER_CDP_TIMEOUT_MS
  })
  let browserDisconnected = false
  browser.on('disconnected', () => {
    browserDisconnected = true
  })
  const context = browser.contexts()[0] || (await browser.newContext())
  let manualVacanciesCleanup: ManualVacanciesCleanupResult | undefined

  if (options.skipManualVacanciesCleanup) {
    manualVacanciesCleanup = {
      skipped: true,
      completed: true,
      initialCount: 0,
      checkedCount: 0,
      removedCount: 0,
      remainingCount: 0,
      keptCount: 0,
      items: []
    }
  } else {
    const cleanupPage = await context.newPage()

    try {
      manualVacanciesCleanup = await dependencies.withTimeout(
        dependencies.runManualVacanciesCleanup(cleanupPage, {
          log: (message: string) =>
            console.log(`[manual vacancies cleanup] ${message}`)
        }),
        HH_INITIAL_NAVIGATION_TIMEOUT_MS,
        `Manual vacancies cleanup did not finish in ${HH_INITIAL_NAVIGATION_TIMEOUT_MS}ms`,
        async () => {
          await dependencies.closePageQuietly(cleanupPage)
        }
      )
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error)
      console.warn(`[manual vacancies cleanup] ${errorMessage}; continuing standard scenario`)
      manualVacanciesCleanup = {
        skipped: false,
        completed: false,
        initialCount: 0,
        checkedCount: 0,
        removedCount: 0,
        remainingCount: 0,
        keptCount: 0,
        error: errorMessage,
        items: [
          {
            id: 'manual-cleanup-error',
            url: '',
            action: 'kept',
            reason: errorMessage
          }
        ]
      }
    } finally {
      await dependencies.closePageQuietly(cleanupPage)
    }
  }

  if (!manualVacanciesCleanup) {
    throw new Error('Manual vacancies cleanup did not return a result')
  }

  if (!manualVacanciesCleanup.completed) {
    console.log(
      `[manual vacancies cleanup] Manual vacancies cleanup left ` +
        `${manualVacanciesCleanup.remainingCount} pending entries; ` +
        `continuing standard scenario`
    )
  }

  const page = await context.newPage()

  options.logLifecycleEvent?.('scenario navigation started', stackScenario)
  await page.goto(stackScenario, {
    waitUntil: 'domcontentloaded',
    timeout: HH_INITIAL_NAVIGATION_TIMEOUT_MS
  })
  options.logLifecycleEvent?.('scenario navigation domcontentloaded', page.url())

  let earlyAuthBeforeStart: HhAuthCheck | undefined

  try {
    earlyAuthBeforeStart = await dependencies.withTimeout(
      dependencies.detectHhAuthState(page),
      HH_SCENARIO_EARLY_AUTH_CHECK_MS,
      `HH scenario early auth check did not finish in ${HH_SCENARIO_EARLY_AUTH_CHECK_MS}ms`
    )
    options.logLifecycleEvent?.(
      'early HH auth checked',
      `${earlyAuthBeforeStart.state}; url ${earlyAuthBeforeStart.url}`
    )
  } catch (error: unknown) {
    options.logLifecycleEvent?.(
      'early HH auth check timed out',
      getErrorMessage(error)
    )
  }

  const earlyPageTitle = await page.title()
  const earlyPageUrl = page.url()
  dependencies.recordVacancyTransition(responseCounter, earlyPageUrl)
  const earlyOpened = isAutoResponderUrl(earlyPageUrl)

  if (
    earlyAuthBeforeStart &&
    ['logged_out', 'captcha'].includes(earlyAuthBeforeStart.state)
  ) {
    options.logLifecycleEvent?.(
      'auto-responder setup skipped because HH auth is missing',
      earlyAuthBeforeStart.state
    )

    return {
      page,
      disposeWatcher: () => undefined,
      isBrowserDisconnected: () => browserDisconnected,
      result: {
        opened: earlyOpened,
        indexScriptInjected: false,
        watcherInstalled: false,
        startButtonClicked: false,
        pageTitle: earlyPageTitle,
        pageUrl: earlyPageUrl,
        manualVacanciesCleanup,
        authBeforeStart: earlyAuthBeforeStart
      }
    }
  }

  await page
    .waitForLoadState('load', {
      timeout: HH_INITIAL_NAVIGATION_TIMEOUT_MS
    })
    .catch(() => undefined)

  const pageTitle = await page.title()
  const pageUrl = page.url()
  dependencies.recordVacancyTransition(responseCounter, pageUrl)
  const opened = isAutoResponderUrl(pageUrl)
  const authBeforeStart =
    earlyAuthBeforeStart?.state === 'logged_in'
      ? earlyAuthBeforeStart
      : await dependencies.detectHhAuthState(page)
  const indexScript =
    dependencies.createCompanyStopListBrowserSource() +
    '\n' +
    (await dependencies.readFile(INDEX_SCRIPT_PATH, 'utf8'))
  const disposeWatcher = dependencies.installIndexReinjectWatcher(
    page,
    indexScript,
    responseCounter
  )

  if (!opened) {
    return {
      page,
      disposeWatcher,
      isBrowserDisconnected: () => browserDisconnected,
      result: {
        opened,
        indexScriptInjected: false,
        watcherInstalled: true,
        startButtonClicked: false,
        pageTitle,
        pageUrl,
        manualVacanciesCleanup,
        authBeforeStart
      }
    }
  }

  if (authBeforeStart.state !== 'logged_in') {
    return {
      page,
      disposeWatcher,
      isBrowserDisconnected: () => browserDisconnected,
      result: {
        opened,
        indexScriptInjected: false,
        watcherInstalled: true,
        startButtonClicked: false,
        pageTitle,
        pageUrl,
        manualVacanciesCleanup,
        authBeforeStart
      }
    }
  }

  await page.evaluate((keys: {
    logsKey: string
    parserErrorsKey: string
    recentUrlsKey: string
    runningKey: string
    stopReasonKey: string
    successfulResponsesKey: string
    successfulResponseIdsKey: string
  }) => {
    sessionStorage.setItem(keys.successfulResponsesKey, '0')
    sessionStorage.removeItem(keys.successfulResponseIdsKey)
    sessionStorage.removeItem(keys.stopReasonKey)
    sessionStorage.removeItem(keys.logsKey)
    sessionStorage.removeItem(keys.parserErrorsKey)
    sessionStorage.removeItem(keys.recentUrlsKey)
    sessionStorage.removeItem(keys.runningKey)
  }, {
    logsKey: HH_AUTO_RESPONDER_LOGS_KEY,
    parserErrorsKey: HH_AUTO_RESPONDER_PARSER_ERRORS_KEY,
    recentUrlsKey: HH_AUTO_RESPONDER_RECENT_URLS_KEY,
    runningKey: HH_AUTO_RESPONDER_RUNNING_KEY,
    stopReasonKey: HH_AUTO_RESPONDER_STOP_REASON_KEY,
    successfulResponsesKey: HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSES_KEY,
    successfulResponseIdsKey: HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSE_IDS_KEY
  })
  await dependencies.applyAutoResponderSettings(page, {
    coverText: options.coverText,
    blockedCompanies: options.blockedCompanies,
    limit: options.responseLimit
  })
  const indexScriptInjected = await dependencies.ensureIndexScript(
    page,
    indexScript,
    'initial load'
  )
  await page.waitForSelector('#ar-start-btn', {
    state: 'visible',
    timeout: 10000
  })
  await page.evaluate(() => {
    const startButton = document.getElementById(
      'ar-start-btn'
    ) as HTMLButtonElement | null

    if (!startButton) {
      throw new Error('Start button was not found')
    }

    startButton.click()
  })

  return {
    page,
    disposeWatcher,
    isBrowserDisconnected: () => browserDisconnected,
    result: {
      opened,
      indexScriptInjected,
      watcherInstalled: true,
      startButtonClicked: true,
      pageTitle,
      pageUrl,
      manualVacanciesCleanup,
      authBeforeStart
    }
  }
}

module.exports = {
  openScenarioAndInjectIndex
}
