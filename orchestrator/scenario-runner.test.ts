const assert = require('node:assert/strict')

const {
  openScenarioAndInjectIndex
} = require('./scenario-runner.ts') as {
  openScenarioAndInjectIndex(
    port: number,
    stackScenario: string,
    responseCounter: any,
    options: any,
    dependencies: any
  ): Promise<any>
}

function authCheck(state: string) {
  return {
    state,
    checkedAt: new Date().toISOString(),
    url: `https://hh.ru/${state}`,
    title: state,
    signals: {
      [state]: {
        exists: true
      }
    }
  }
}

function makePage(url = 'https://hh.ru/search/vacancy'): any {
  const page = {
    loadWaitCount: 0,
    selectorWaitCount: 0,
    evaluateCount: 0,
    gotoCalls: [] as Array<{ url: string; options?: Record<string, unknown> }>,
    isClosed: () => false,
    url: () => url,
    title: async () => 'HH search',
    goto: async (nextUrl: string, options?: Record<string, unknown>) => {
      url = nextUrl
      page.gotoCalls.push({ url: nextUrl, options })
    },
    waitForLoadState: async (state?: string) => {
      if (state === 'load') {
        page.loadWaitCount += 1
      }
    },
    waitForSelector: async () => {
      page.selectorWaitCount += 1
    },
    evaluate: async () => {
      page.evaluateCount += 1
    }
  }

  return page
}

function makeDependencies(states: string[]) {
  const page = makePage()
  let detectCount = 0
  let readFileCount = 0
  let installWatcherCount = 0
  let ensureIndexCount = 0
  let applySettingsCount = 0

  return {
    page,
    counts: {
      get detectCount() {
        return detectCount
      },
      get readFileCount() {
        return readFileCount
      },
      get installWatcherCount() {
        return installWatcherCount
      },
      get ensureIndexCount() {
        return ensureIndexCount
      },
      get applySettingsCount() {
        return applySettingsCount
      }
    },
    dependencies: {
      applyAutoResponderSettings: async () => {
        applySettingsCount += 1
      },
      closePageQuietly: async () => undefined,
      createCompanyStopListBrowserSource: () => 'stop-list-source',
      detectHhAuthState: async () => {
        const state = states[detectCount] ?? states[states.length - 1] ?? 'unknown'
        detectCount += 1
        return authCheck(state)
      },
      ensureIndexScript: async () => {
        ensureIndexCount += 1
        return true
      },
      installIndexReinjectWatcher: () => {
        installWatcherCount += 1
        return () => undefined
      },
      loadPlaywright: () => ({
        chromium: {
          connectOverCDP: async () => ({
            on: () => undefined,
            contexts: () => [
              {
                newPage: async () => page
              }
            ]
          })
        }
      }),
      readFile: async () => {
        readFileCount += 1
        return 'index-script'
      },
      recordVacancyTransition: () => undefined,
      runManualVacanciesCleanup: async () => {
        throw new Error('cleanup should be skipped in these tests')
      },
      withTimeout: async (promise: Promise<unknown>) => await promise
    }
  }
}

async function runScenario(states: string[], lifecycleEvents: string[] = []) {
  const fixture = makeDependencies(states)
  const result = await openScenarioAndInjectIndex(
    12345,
    'https://hh.ru/search/vacancy',
    { vacancyIds: new Set() },
    {
      skipManualVacanciesCleanup: true,
      logLifecycleEvent: (event: string) => lifecycleEvents.push(event)
    },
    fixture.dependencies
  )

  return {
    ...fixture,
    result
  }
}

async function testLoggedOutSkipsAutoResponderSetup(): Promise<void> {
  const lifecycleEvents: string[] = []
  const { counts, page, result } = await runScenario(['logged_out'], lifecycleEvents)

  assert.equal(result.result.authBeforeStart.state, 'logged_out')
  assert.equal(result.result.startButtonClicked, false)
  assert.equal(result.result.watcherInstalled, false)
  assert.equal(page.loadWaitCount, 0)
  assert.equal(counts.readFileCount, 0)
  assert.equal(counts.installWatcherCount, 0)
  assert.equal(counts.ensureIndexCount, 0)
  assert.ok(lifecycleEvents.includes('auto-responder setup skipped because HH auth is missing'))
}

async function testCaptchaSkipsAutoResponderSetup(): Promise<void> {
  const { counts, result } = await runScenario(['captcha'])

  assert.equal(result.result.authBeforeStart.state, 'captcha')
  assert.equal(result.result.watcherInstalled, false)
  assert.equal(counts.readFileCount, 0)
  assert.equal(counts.installWatcherCount, 0)
}

async function testLoggedInContinuesNormalSetup(): Promise<void> {
  const { counts, page, result } = await runScenario(['logged_in'])

  assert.equal(result.result.authBeforeStart.state, 'logged_in')
  assert.equal(result.result.startButtonClicked, true)
  assert.equal(result.result.watcherInstalled, true)
  assert.equal(page.loadWaitCount, 1)
  assert.equal(counts.readFileCount, 1)
  assert.equal(counts.installWatcherCount, 1)
  assert.equal(counts.applySettingsCount, 1)
  assert.equal(counts.ensureIndexCount, 1)
}

async function testUnknownPreservesSlowFallback(): Promise<void> {
  const { counts, page, result } = await runScenario(['unknown', 'logged_out'])

  assert.equal(result.result.authBeforeStart.state, 'logged_out')
  assert.equal(result.result.startButtonClicked, false)
  assert.equal(result.result.watcherInstalled, true)
  assert.equal(page.loadWaitCount, 1)
  assert.equal(counts.detectCount, 2)
  assert.equal(counts.readFileCount, 1)
  assert.equal(counts.installWatcherCount, 1)
}

async function main(): Promise<void> {
  await testLoggedOutSkipsAutoResponderSetup()
  await testCaptchaSkipsAutoResponderSetup()
  await testLoggedInContinuesNormalSetup()
  await testUnknownPreservesSlowFallback()

  console.log('orchestrator scenario runner tests passed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
