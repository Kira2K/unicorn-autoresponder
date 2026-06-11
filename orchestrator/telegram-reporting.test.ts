const assert = require('node:assert/strict')

const {
  formatCaptchaProfilesSummary,
  formatRunSummaryLog
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

testNoCaptchaSummary()
testSingleThrownCaptchaSummary()
testMultipleCaptchaSummary()
testRunSummaryIncludesCaptchaBlock()

console.log('orchestrator telegram reporting tests passed')
