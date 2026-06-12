const assert = require('node:assert/strict')

const {
  classifyClientRun,
  isClientRunSuccessful,
  isStopReasonNormal,
  normalizeManualVacancies,
  normalizeParserErrorCode,
  normalizeParserErrors,
  normalizeStopReason
} = require('./scraper-state.ts')
const {
  getAutoReloadRecoveryReason
} = require('./recovery.ts')

type ClientAutomationData = import('./types.ts').ClientAutomationData
type OrchestratorStatus = import('./types.ts').OrchestratorStatus
type RunnableClientAutomationData =
  import('./types.ts').RunnableClientAutomationData

function makeStatus(
  patch: Partial<OrchestratorStatus> = {}
): OrchestratorStatus {
  return {
    clientName: 'Kira',
    stack: 'Frontend',
    market: 'Ru',
    dolphinProfileId: 123,
    commonChatId: '-100',
    stackScenario: 'https://hh.ru/search/vacancy',
    lifecycleEvents: [],
    opened: true,
    indexScriptInjected: true,
    watcherInstalled: true,
    startButtonClicked: true,
    ...patch
  }
}

function assertRunnableClient(
  client: ClientAutomationData
): RunnableClientAutomationData {
  if (!client.stackScenario) {
    throw new Error('Expected stackScenario')
  }

  const stackScenario: string = client.stackScenario

  return {
    ...client,
    stackScenario
  }
}

function testClientTypeCompatibility(): void {
  const dbCompatibleClient: ClientAutomationData = {
    clientName: 'Kira',
    stack: 'Frontend',
    market: 'Ru',
    stackSheetName: 'FRONTEND',
    stackScenario: 'https://hh.ru/search/vacancy',
    dolphinProfileId: 123,
    commonChatId: '-100',
    hhAuthCredentials: {
      clientName: 'Kira',
      market: 'Ru',
      phone: '9775442105',
      rawPhone: '+79775442105',
      password: 'temporary-password'
    }
  }

  const runnable = assertRunnableClient(dbCompatibleClient)

  assert.equal(runnable.stackScenario, 'https://hh.ru/search/vacancy')
  assert.equal(runnable.hhAuthCredentials?.email, undefined)
}

function testManualVacancyNormalization(): void {
  assert.deepEqual(
    normalizeManualVacancies([
      { vid: '1', url: 'https://hh.ru/vacancy/1', ts: '123', title: 'A' },
      { title: 'broken' },
      null,
      'bad'
    ]),
    [
      {
        vid: '1',
        url: 'https://hh.ru/vacancy/1',
        ts: 123,
        title: 'A'
      }
    ]
  )
}

function testParserErrorNormalization(): void {
  assert.deepEqual(
    normalizeParserErrors([
      {
        code: 'AUTH_REQUIRED',
        details: 'login',
        recentUrls: [{ url: 'https://hh.ru/vacancy/1', reason: 'current' }]
      },
      { recentUrls: 'bad' },
      null
    ]),
    [
      {
        code: 'AUTH_REQUIRED',
        details: 'login',
        recentUrls: [{ url: 'https://hh.ru/vacancy/1', reason: 'current' }]
      }
    ]
  )
}

function testStopReasonNormalization(): void {
  assert.deepEqual(normalizeStopReason('targets_processed'), {
    kind: 'known_stop_reason',
    reason: 'targets_processed'
  })
  assert.deepEqual(normalizeStopReason({ reason: 'future_hh_weirdness' }), {
    kind: 'unknown_stop_reason',
    reason: 'future_hh_weirdness'
  })
}

function testParserCodeNormalization(): void {
  assert.deepEqual(normalizeParserErrorCode('AUTH_REQUIRED'), {
    kind: 'known_parser_code',
    code: 'AUTH_REQUIRED'
  })
  assert.deepEqual(normalizeParserErrorCode('NEW_HH_CODE'), {
    kind: 'unknown_parser_code',
    code: 'NEW_HH_CODE'
  })
}

function testRunClassification(): void {
  assert.equal(
    classifyClientRun(
      makeStatus({
        autoResponderStopReason: 'targets_processed'
      })
    ),
    'success'
  )
  assert.equal(
    isClientRunSuccessful(
      makeStatus({
        autoResponderStopReason: 'targets_processed',
        parserErrorCodes: ['COMPANY_STOP_LIST_SKIPPED']
      })
    ),
    true
  )
  assert.equal(
    classifyClientRun(
      makeStatus({
        autoResponderStopReason: 'auth_required',
        parserErrorCodes: ['AUTH_REQUIRED']
      })
    ),
    'auth_required'
  )
  assert.equal(
    classifyClientRun(
      makeStatus({
        authAfterParserStop: {
          state: 'captcha',
          checkedAt: new Date().toISOString(),
          url: 'https://hh.ru',
          title: 'captcha',
          signals: {}
        }
      })
    ),
    'captcha_detected'
  )
  assert.equal(
    classifyClientRun(
      makeStatus({
        error: 'HH captcha detected during auth flow'
      })
    ),
    'captcha_detected'
  )
}

function testTimeoutClassificationNeedsHealthyCleanup(): void {
  const healthyTimeout = makeStatus({
    autoResponderStopReason: 'orchestrator_stop_after_watch',
    autoResponderWatchTimedOut: true,
    profileStopped: true,
    profileTagRemoved: true,
    profileStatusRestored: true
  })
  const unhealthyTimeout = makeStatus({
    autoResponderStopReason: 'orchestrator_stop_after_watch',
    autoResponderWatchTimedOut: true,
    profileStopped: true,
    profileTagRemoved: false,
    profileStatusRestored: true
  })

  assert.equal(isStopReasonNormal(healthyTimeout), true)
  assert.equal(classifyClientRun(healthyTimeout), 'normal_timeout')
  assert.equal(isStopReasonNormal(unhealthyTimeout), false)
  assert.equal(classifyClientRun(unhealthyTimeout), 'scraper_error')
}

function testAutoReloadRecoveryClassification(): void {
  assert.equal(
    getAutoReloadRecoveryReason({
      status: makeStatus(),
      error: new Error('page.goto: Timeout 250000ms exceeded.')
    }),
    'navigation_timeout'
  )
  assert.equal(
    getAutoReloadRecoveryReason({
      status: makeStatus(),
      error: new Error("page.waitForSelector: Timeout 10000ms exceeded. waiting for locator('#ar-main-panel')")
    }),
    'start_ui_selector_timeout'
  )
  assert.equal(
    getAutoReloadRecoveryReason({
      status: makeStatus({
        autoResponderStopReason: 'auth_required',
        parserErrorCodes: ['AUTH_REQUIRED'],
        authAfterParserStop: {
          state: 'logged_in',
          checkedAt: new Date().toISOString(),
          url: 'https://hh.ru',
          title: 'HH',
          signals: {}
        }
      })
    }),
    'auth_required_after_logged_in'
  )
  assert.equal(
    getAutoReloadRecoveryReason({
      status: makeStatus({
        autoResponderFinished: false,
        autoResponderWatchTimedOut: true,
        parserErrorCodes: []
      })
    }),
    'no_reason_watch_timeout'
  )
  assert.equal(
    getAutoReloadRecoveryReason({
      status: makeStatus({
        autoResponderStopReason: 'captcha_detected',
        parserErrorCodes: ['captcha_detected']
      })
    }),
    undefined
  )
  assert.equal(
    getAutoReloadRecoveryReason({
      status: makeStatus(),
      error: new Error('HH login form did not open from the home page or direct login URL')
    }),
    undefined
  )
  assert.equal(
    getAutoReloadRecoveryReason({
      status: makeStatus({ autoReloadRecoveryAttempted: true }),
      error: new Error('page.goto: Timeout 250000ms exceeded.')
    }),
    undefined
  )
}

testClientTypeCompatibility()
testManualVacancyNormalization()
testParserErrorNormalization()
testStopReasonNormalization()
testParserCodeNormalization()
testRunClassification()
testTimeoutClassificationNeedsHealthyCleanup()
testAutoReloadRecoveryClassification()

console.log('orchestrator type/refactor tests passed')
