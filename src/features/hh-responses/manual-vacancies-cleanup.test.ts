const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  runManualVacanciesCleanup
} = require('./manual-vacancies-cleanup.ts') as {
  runManualVacanciesCleanup(page: any, options?: Record<string, unknown>): Promise<any>
}

async function testAlreadyClosedPageSkipsImmediately(): Promise<void> {
  let gotoCalled = false
  const result = await runManualVacanciesCleanup(
    {
      isClosed: () => true,
      goto: async () => {
        gotoCalled = true
      }
    },
    {
      timeoutMs: 1
    }
  )

  assert.equal(gotoCalled, false)
  assert.equal(result.skipped, true)
  assert.equal(result.completed, true)
  assert.match(result.error, /already closed/)
}

async function testClosedPageDuringVacancyCheckReturnsFast(): Promise<void> {
  let closed = false
  let gotoCount = 0

  const result = await runManualVacanciesCleanup(
    {
      isClosed: () => closed,
      goto: async () => {
        gotoCount += 1

        if (gotoCount > 1) {
          closed = true
          throw new Error('Target page, context or browser has been closed')
        }
      },
      waitForLoadState: async () => undefined,
      evaluate: async () => [
        {
          vid: 'v_123',
          url: 'https://hh.ru/vacancy/123',
          returnUrl: 'https://hh.ru/search/vacancy',
          title: 'Manual target'
        }
      ]
    },
    {
      timeoutMs: 1
    }
  )

  assert.equal(result.skipped, true)
  assert.equal(result.completed, false)
  assert.equal(result.initialCount, 1)
  assert.equal(result.checkedCount, 1)
  assert.match(result.error, /closed while checking manual vacancy/)
}

function testForcedManualReturnIsNotParserError(): void {
  const source = fs.readFileSync(
    path.join(__dirname, 'browser-responder/index.js'),
    'utf8'
  )

  assert.equal(source.includes("addParserError('MANUAL_RETURN_FORCED'"), false)
}

function testNoApplyReturnedIsRecoverable(): void {
  const source = fs.readFileSync(
    path.join(__dirname, 'browser-responder/index.js'),
    'utf8'
  )

  assert.equal(
    source.includes("res === 'NO_APPLY_RETURNED' || res === 'ERROR_NO_MODAL'"),
    false
  )
  assert.match(
    source,
    /res === 'NO_APPLY_RETURNED'[\s\S]*handleRecoverableVacancyFailure\(res/
  )
  assert.match(
    source,
    /result === 'NO_APPLY_RETURNED'[\s\S]*handleRecoverableVacancyFailure\(result/
  )
  assert.match(
    source,
    /MAX_CONSECUTIVE_RECOVERABLE_VACANCY_FAILURES = 5/
  )
  assert.match(source, /'vacancy_recovery_limit_exceeded'/)
  assert.match(source, /'RECOVERABLE_VACANCY_SKIPPED'/)
}

async function main(): Promise<void> {
  await testAlreadyClosedPageSkipsImmediately()
  await testClosedPageDuringVacancyCheckReturnsFast()
  testForcedManualReturnIsNotParserError()
  testNoApplyReturnedIsRecoverable()

  console.log('manual vacancies cleanup tests passed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
