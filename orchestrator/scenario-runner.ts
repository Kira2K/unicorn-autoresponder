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
  HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSES_KEY,
  HH_INITIAL_NAVIGATION_TIMEOUT_MS,
  INDEX_SCRIPT_PATH
} = require('./config.ts')

type ManualVacanciesCleanupResult =
  import('./types.ts').ManualVacanciesCleanupResult
type OpenScenarioResult = import('./types.ts').OpenScenarioResult
type ResponseCounter = import('./types.ts').ResponseCounter

async function openScenarioAndInjectIndex(
  port: number,
  stackScenario: string,
  responseCounter: ResponseCounter,
  options: {
    coverText?: string
    blockedCompanies?: Array<{ id: string; name: string }>
  } = {}
): Promise<OpenScenarioResult> {
  const { chromium } = loadPlaywright()
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
    timeout: CONNECT_OVER_CDP_TIMEOUT_MS
  })
  let browserDisconnected = false
  browser.on('disconnected', () => {
    browserDisconnected = true
  })
  const context = browser.contexts()[0] || (await browser.newContext())
  const cleanupPage = await context.newPage()
  let manualVacanciesCleanup: ManualVacanciesCleanupResult | undefined

  try {
    manualVacanciesCleanup = await withTimeout(
      runManualVacanciesCleanup(cleanupPage, {
        log: (message: string) =>
          console.log(`[manual vacancies cleanup] ${message}`)
      }),
      HH_INITIAL_NAVIGATION_TIMEOUT_MS,
      `Manual vacancies cleanup did not finish in ${HH_INITIAL_NAVIGATION_TIMEOUT_MS}ms`,
      async () => {
        await closePageQuietly(cleanupPage)
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
    await closePageQuietly(cleanupPage)
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
  const indexScript =
    createCompanyStopListBrowserSource() +
    '\n' +
    (await fs.readFile(INDEX_SCRIPT_PATH, 'utf8'))
  const disposeWatcher = installIndexReinjectWatcher(
    page,
    indexScript,
    responseCounter
  )

  await page.goto(stackScenario, {
    waitUntil: 'domcontentloaded',
    timeout: HH_INITIAL_NAVIGATION_TIMEOUT_MS
  })
  await page
    .waitForLoadState('load', {
      timeout: HH_INITIAL_NAVIGATION_TIMEOUT_MS
    })
    .catch(() => undefined)

  const pageTitle = await page.title()
  const pageUrl = page.url()
  recordVacancyTransition(responseCounter, pageUrl)
  const opened = isAutoResponderUrl(pageUrl)
  const authBeforeStart = await detectHhAuthState(page)

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

  await page.evaluate((successfulResponsesKey: string) => {
    sessionStorage.setItem(successfulResponsesKey, '0')
  }, HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSES_KEY)
  await applyAutoResponderSettings(page, {
    coverText: options.coverText,
    blockedCompanies: options.blockedCompanies
  })
  const indexScriptInjected = await ensureIndexScript(
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
