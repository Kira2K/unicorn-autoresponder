const assert = require('node:assert/strict')

const {
  formatCaptchaProfilesSummary,
  formatRunSummaryLog,
  hasClientFailure
} = require('./telegram-reporting.ts')

type OrchestratorStatus = import('./types.ts').OrchestratorStatus

function makeStatus(
  patch: Partial<OrchestratorStatus> = {}
): OrchestratorStatus {
  return {
    clientName: 'Кира',
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

function testNoCaptchaSummary(): void {
  assert.equal(formatCaptchaProfilesSummary([makeStatus()]), undefined)
}

function testSingleThrownCaptchaSummary(): void {
  assert.equal(
    formatCaptchaProfilesSummary([
      makeStatus({ error: 'HH captcha detected during auth flow' })
    ]),
    [
      'captcha found for profiles Кира / Ru',
      '@kiraSamsonova нужно починить капчу'
    ].join('\n')
  )
}

function testMultipleCaptchaSummary(): void {
  assert.equal(
    formatCaptchaProfilesSummary([
      makeStatus({ error: 'HH captcha detected during auth flow' }),
      makeStatus({
        clientName: 'Мария Андреева',
        authAfterParserStop: {
          state: 'captcha',
          checkedAt: '2026-06-11T00:00:00.000Z',
          url: 'https://hh.ru',
          title: 'HH',
          signals: {}
        }
      })
    ]),
    [
      'captcha found for profiles Кира / Ru, Мария Андреева / Ru',
      '@kiraSamsonova нужно починить капчу'
    ].join('\n')
  )
}

function testRunSummaryIncludesCaptchaBlock(): void {
  const summary = formatRunSummaryLog([
    makeStatus({ error: 'HH captcha detected during auth flow' })
  ])

  assert.match(summary, /captcha found for profiles Кира \/ Ru/)
  assert.match(summary, /@kiraSamsonova нужно починить капчу/)
}

function testTimerReachedIsOkEvenWhenResponseLimitNotMet(): void {
  const status = makeStatus({
    autoResponderStopReason: 'orchestrator_stop_after_watch',
    autoResponderWatchTimedOut: true,
    profileStopped: true,
    profileTagRemoved: true,
    profileStatusRestored: true,
    requiredResponseLimit: 180,
    metResponseLimit: false,
    completionGap: 'orchestrator_stop_after_watch:missing_178_responses',
    responseCount: 2,
    manualVacanciesCount: 7
  })
  const summary = formatRunSummaryLog([status])

  assert.equal(hasClientFailure(status), false)
  assert.match(summary, /Ок: 1/)
  assert.match(summary, /Нужно проверить: 0/)
}

function testAcceptedTerminalStopsAreGreenDots(): void {
  const manualOnly = makeStatus({
    clientName: 'Самвел Мхитарян',
    autoResponderStopReason: 'manual_targets_only',
    parserErrorCodes: ['MANUAL_RETURN_FORCED'],
    requiredResponseLimit: 170,
    metResponseLimit: false,
    completionGap: 'manual_targets_only:missing_83_responses',
    responseCount: 87,
    manualVacanciesCount: 37
  })
  const dailyLimit = makeStatus({
    clientName: 'Андрей Пашинцев',
    autoResponderStopReason: 'hh_response_daily_limit_exceeded',
    parserErrorCodes: ['DAILY_RESPONSE_LIMIT'],
    requiredResponseLimit: 170,
    metResponseLimit: false,
    completionGap: 'hh_response_daily_limit_exceeded:missing_164_responses',
    responseCount: 6,
    manualVacanciesCount: 13
  })
  const summary = formatRunSummaryLog([manualOnly, dailyLimit])

  assert.equal(hasClientFailure(manualOnly), false)
  assert.equal(hasClientFailure(dailyLimit), false)
  assert.match(summary, /Ок: 2/)
  assert.match(summary, /Нужно проверить: 0/)
  assert.match(summary, /Самвел Мхитарян \/ Ru: 🟢/)
  assert.match(summary, /Андрей Пашинцев \/ Ru: 🟢/)
}

testNoCaptchaSummary()
testSingleThrownCaptchaSummary()
testMultipleCaptchaSummary()
testRunSummaryIncludesCaptchaBlock()
testTimerReachedIsOkEvenWhenResponseLimitNotMet()
testAcceptedTerminalStopsAreGreenDots()

console.log('orchestrator telegram reporting tests passed')
