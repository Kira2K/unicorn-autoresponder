const assert = require('node:assert/strict')

const {
  assertDolphinLocalApiResponseHealthy,
  isDolphinSessionError
} = require('./preflight.ts')

function makeResponse(patch: Partial<{
  ok: boolean
  status: number
  statusText: string
}> = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    ...patch
  }
}

function assertThrowsMessage(fn: () => void, pattern: RegExp): void {
  assert.throws(fn, (error: unknown) => {
    if (!(error instanceof Error)) {
      return false
    }

    assert.match(error.message, pattern)
    return true
  })
}

function testHealthyResponsePasses(): void {
  assertDolphinLocalApiResponseHealthy(makeResponse(), '[]')
}

function testInvalidSessionFailsWithRepairMessage(): void {
  assert.equal(isDolphinSessionError(401, '{"error":"invalid session token"}'), true)
  assertThrowsMessage(
    () =>
      assertDolphinLocalApiResponseHealthy(
        makeResponse({ ok: false, status: 401, statusText: 'Unauthorized' }),
        '{"success":false,"error":"invalid session token"}',
        'http://localhost:3001/v1.0'
      ),
    /re-login.*browser profiles are visible.*401 Unauthorized.*invalid session token/i
  )
}

function testTokenRefreshTimeoutFailsWithRepairMessage(): void {
  assert.equal(isDolphinSessionError(500, 'Token refresh timeout after 30 seconds'), true)
  assertThrowsMessage(
    () =>
      assertDolphinLocalApiResponseHealthy(
        makeResponse({ ok: false, status: 500, statusText: 'Internal Server Error' }),
        'Token refresh timeout after 30 seconds'
      ),
    /re-login.*token refresh timeout after 30 seconds/i
  )
}

function testOtherBadResponseFailsAsHealthCheck(): void {
  assertThrowsMessage(
    () =>
      assertDolphinLocalApiResponseHealthy(
        makeResponse({ ok: false, status: 503, statusText: 'Service Unavailable' }),
        'maintenance'
      ),
    /health check failed.*503 Service Unavailable.*maintenance/i
  )
}

testHealthyResponsePasses()
testInvalidSessionFailsWithRepairMessage()
testTokenRefreshTimeoutFailsWithRepairMessage()
testOtherBadResponseFailsAsHealthCheck()

console.log('dolphin preflight tests passed')
