const assert = require('node:assert/strict')

process.env.HH_SCENARIO_AUTH_UNKNOWN_RECHECK_INTERVAL_MS = '0'
process.env.HH_SCENARIO_AUTH_UNKNOWN_RECHECK_MS = '10000'
process.env.HH_SCENARIO_AUTH_MAX_RECHECKS = '3'

const {
  detectHhAuthState,
  waitForScenarioAuthDecision
} = require('./orchestrator.ts') as {
  detectHhAuthState(page: any): Promise<any>
  waitForScenarioAuthDecision(
    page: any,
    initialCheck: any
  ): Promise<{ check: any; recheckCount: number }>
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

function makePage(checks: any[]) {
  let evaluateCount = 0

  return {
    get evaluateCount() {
      return evaluateCount
    },
    isClosed: () => false,
    url: () => 'https://hh.ru/search/vacancy',
    title: async () => 'HH',
    goto: async () => undefined,
    waitForLoadState: async () => undefined,
    waitForSelector: async () => undefined,
    evaluate: async () => {
      const fallback = checks[checks.length - 1] ?? authCheck('unknown')
      const check = checks[evaluateCount] ?? fallback
      evaluateCount += 1

      return check
    }
  }
}

function makeDetectPage(checks: any[], options: { closed?: boolean } = {}) {
  let evaluateCount = 0

  return {
    get evaluateCount() {
      return evaluateCount
    },
    isClosed: () => Boolean(options.closed),
    url: () => 'https://hh.ru/search/vacancy',
    waitForLoadState: async () => undefined,
    evaluate: async () => {
      const fallback = checks[checks.length - 1] ?? authCheck('unknown')
      const check = checks[evaluateCount] ?? fallback
      evaluateCount += 1

      return check
    }
  }
}

async function testQuickAuthProbeReturnsAfterOneEvaluate(): Promise<void> {
  const page = makeDetectPage([
    {
      ...authCheck('logged_in'),
      quickAuthProbe: true
    }
  ])

  const result = await detectHhAuthState(page)

  assert.equal(result.state, 'logged_in')
  assert.equal(result.quickAuthProbe, undefined)
  assert.equal(page.evaluateCount, 1)
}

async function testUnknownQuickProbeFallsBackToFullScan(): Promise<void> {
  const page = makeDetectPage([
    {
      ...authCheck('unknown'),
      quickAuthProbe: true
    },
    authCheck('captcha')
  ])

  const result = await detectHhAuthState(page)

  assert.equal(result.state, 'captcha')
  assert.equal(page.evaluateCount, 2)
}

async function testClosedPageDoesNotEvaluate(): Promise<void> {
  const page = makeDetectPage([], { closed: true })

  const result = await detectHhAuthState(page)

  assert.equal(result.state, 'unknown')
  assert.equal(result.url, 'closed-page')
  assert.equal(page.evaluateCount, 0)
}

async function testUnknownRechecksExactlyThreeTimes(): Promise<void> {
  const page = makePage([
    authCheck('unknown'),
    authCheck('unknown'),
    authCheck('unknown'),
    authCheck('logged_in')
  ])

  const result = await waitForScenarioAuthDecision(page, authCheck('unknown'))

  assert.equal(result.recheckCount, 3)
  assert.equal(page.evaluateCount, 3)
  assert.equal(result.check.state, 'unknown')
}

async function testCaptchaRecheckReturnsEarly(): Promise<void> {
  const page = makePage([authCheck('captcha')])

  const result = await waitForScenarioAuthDecision(page, authCheck('unknown'))

  assert.equal(result.recheckCount, 1)
  assert.equal(page.evaluateCount, 1)
  assert.equal(result.check.state, 'captcha')
}

async function testNonIndecisiveStateDoesNotRecheck(): Promise<void> {
  const page = makePage([authCheck('unknown')])

  const result = await waitForScenarioAuthDecision(page, authCheck('logged_in'))

  assert.equal(result.recheckCount, 0)
  assert.equal(page.evaluateCount, 0)
  assert.equal(result.check.state, 'logged_in')
}

async function main(): Promise<void> {
  await testQuickAuthProbeReturnsAfterOneEvaluate()
  await testUnknownQuickProbeFallsBackToFullScan()
  await testClosedPageDoesNotEvaluate()
  await testUnknownRechecksExactlyThreeTimes()
  await testCaptchaRecheckReturnsEarly()
  await testNonIndecisiveStateDoesNotRecheck()

  console.log('hh auth orchestrator tests passed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
