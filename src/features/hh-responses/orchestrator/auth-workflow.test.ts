const assert = require('node:assert/strict')

const {
  ensureScenarioAuthorizedBeforeStart
} = require('./auth-workflow.ts') as {
  ensureScenarioAuthorizedBeforeStart(
    options: any,
    dependencies: any
  ): Promise<{
    pageResult: any
    status: any
    disposeWatcher?: () => void
  }>
}

function authCheck(state: string, url = 'https://hh.ru/search/vacancy') {
  return {
    state,
    checkedAt: new Date().toISOString(),
    url,
    title: state,
    signals: {
      [state]: {
        exists: true
      }
    }
  }
}

function makePage(name: string) {
  return {
    name,
    isClosed: () => false,
    url: () => `https://hh.ru/${name}`,
    title: async () => name,
    goto: async () => undefined,
    waitForLoadState: async () => undefined,
    waitForSelector: async () => undefined,
    evaluate: async () => undefined
  }
}

function makePageResult(
  state: string,
  options: { startButtonClicked?: boolean; pageName?: string } = {}
) {
  return {
    page: makePage(options.pageName ?? state),
    disposeWatcher: () => undefined,
    isBrowserDisconnected: () => false,
    result: {
      opened: true,
      indexScriptInjected: false,
      watcherInstalled: true,
      startButtonClicked: Boolean(options.startButtonClicked),
      pageTitle: state,
      pageUrl: `https://hh.ru/${state}`,
      manualVacanciesCleanup: {
        skipped: true,
        completed: true,
        initialCount: 0,
        checkedCount: 0,
        removedCount: 0,
        remainingCount: 0,
        keptCount: 0,
        items: []
      },
      authBeforeStart: authCheck(state)
    }
  }
}

function makeStatus(state: string, startButtonClicked = false) {
  return {
    clientName: 'Kira',
    stack: 'Backend',
    market: 'Ru',
    dolphinProfileId: 770032142,
    commonChatId: '5216637594',
    stackScenario: 'https://hh.ru/search/vacancy',
    lifecycleEvents: [],
    opened: true,
    indexScriptInjected: false,
    watcherInstalled: true,
    startButtonClicked,
    authBeforeStart: authCheck(state)
  }
}

function makeDependencies(patch: Record<string, unknown> = {}) {
  return {
    async closePageQuietly() {},
    async ensureHHAuthOnCurrentPage() {
      return authCheck('logged_in')
    },
    async removeAutoResponderUi() {},
    async waitForScenarioAuthDecision() {
      return {
        check: authCheck('logged_in'),
        recheckCount: 1
      }
    },
    ...patch
  }
}

async function testUnknownBecomesLoggedInAfterRecheck(): Promise<void> {
  let reopenCount = 0
  const result = await ensureScenarioAuthorizedBeforeStart(
    {
      clientData: makeStatus('unknown'),
      runStartedAt: Date.now(),
      state: {
        pageResult: makePageResult('unknown'),
        status: makeStatus('unknown')
      },
      async reopenScenario(status: any) {
        reopenCount += 1
        return {
          pageResult: makePageResult('logged_in', { startButtonClicked: true }),
          status: {
            ...status,
            startButtonClicked: true,
            authBeforeStart: authCheck('logged_in')
          }
        }
      }
    },
    makeDependencies()
  )

  assert.equal(reopenCount, 1)
  assert.equal(result.status.authBeforeStart.state, 'logged_in')
  assert.equal(result.pageResult.result.startButtonClicked, true)
}

async function testLoggedOutRunsCurrentPageAuth(): Promise<void> {
  let removedUi = false
  let ensuredAuth = false
  let reopened = false

  const result = await ensureScenarioAuthorizedBeforeStart(
    {
      clientData: makeStatus('logged_out'),
      runStartedAt: Date.now(),
      state: {
        pageResult: makePageResult('logged_out'),
        status: makeStatus('logged_out')
      },
      async reopenScenario(status: any) {
        reopened = true
        return {
          pageResult: makePageResult('logged_in', { startButtonClicked: true }),
          status: {
            ...status,
            startButtonClicked: true,
            authBeforeStart: authCheck('logged_in')
          }
        }
      }
    },
    makeDependencies({
      async removeAutoResponderUi() {
        removedUi = true
      },
      async ensureHHAuthOnCurrentPage() {
        ensuredAuth = true
        return authCheck('logged_in')
      }
    })
  )

  assert.equal(removedUi, true)
  assert.equal(ensuredAuth, true)
  assert.equal(reopened, true)
  assert.equal(result.status.authBeforeStart.state, 'logged_in')
}

async function testCaptchaFailsFast(): Promise<void> {
  let ensuredAuth = false

  await assert.rejects(
    () =>
      ensureScenarioAuthorizedBeforeStart(
        {
          clientData: makeStatus('captcha'),
          runStartedAt: Date.now(),
          state: {
            pageResult: makePageResult('captcha'),
            status: makeStatus('captcha')
          },
          async reopenScenario() {
            throw new Error('should not reopen on captcha')
          }
        },
        makeDependencies({
          async ensureHHAuthOnCurrentPage() {
            ensuredAuth = true
            return authCheck('logged_in')
          }
        })
      ),
    /captcha detected/i
  )

  assert.equal(ensuredAuth, false)
}

async function testCaptchaAfterRecheckFailsFast(): Promise<void> {
  let ensuredAuth = false

  await assert.rejects(
    () =>
      ensureScenarioAuthorizedBeforeStart(
        {
          clientData: makeStatus('unknown'),
          runStartedAt: Date.now(),
          state: {
            pageResult: makePageResult('unknown'),
            status: makeStatus('unknown')
          },
          async reopenScenario() {
            throw new Error('should not reopen on captcha')
          }
        },
        makeDependencies({
          async ensureHHAuthOnCurrentPage() {
            ensuredAuth = true
            return authCheck('logged_in')
          },
          async waitForScenarioAuthDecision() {
            return {
              check: authCheck('captcha'),
              recheckCount: 1
            }
          }
        })
      ),
    /captcha detected/i
  )

  assert.equal(ensuredAuth, false)
}

async function testUnknownStaysUnknownFailsBeforeResponder(): Promise<void> {
  await assert.rejects(
    () =>
      ensureScenarioAuthorizedBeforeStart(
        {
          clientData: makeStatus('unknown'),
          runStartedAt: Date.now(),
          state: {
            pageResult: makePageResult('unknown', { startButtonClicked: false }),
            status: makeStatus('unknown')
          },
          async reopenScenario() {
            throw new Error('should not reopen persistent unknown')
          }
        },
        makeDependencies({
          async waitForScenarioAuthDecision() {
            return {
              check: authCheck('unknown'),
              recheckCount: 3
            }
          }
        })
      ),
    /stayed unknown/
  )
}

async function main(): Promise<void> {
  await testUnknownBecomesLoggedInAfterRecheck()
  await testLoggedOutRunsCurrentPageAuth()
  await testCaptchaFailsFast()
  await testCaptchaAfterRecheckFailsFast()
  await testUnknownStaysUnknownFailsBeforeResponder()

  console.log('orchestrator auth workflow tests passed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
