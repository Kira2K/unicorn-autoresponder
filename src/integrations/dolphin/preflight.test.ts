const assert = require('node:assert/strict')

const {
  assertDolphinLocalApiResponseHealthy,
  assertDolphinAppRunning,
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

async function testDolphinAppRunningStoresLocalApiToken(): Promise<void> {
  const previousFetch = global.fetch
  const previousToken = process.env.dolphin_api_token
  const calls: Array<{ url: string; body?: string }> = []

  process.env.dolphin_api_token = 'local-token-test'
  global.fetch = (async (url: string, options: any = {}) => {
    calls.push({
      url,
      body: options.body
    })

    return new Response('{"success":true}', {
      status: 200,
      statusText: 'OK'
    })
  }) as typeof fetch

  try {
    await assertDolphinAppRunning()
  } finally {
    global.fetch = previousFetch

    if (previousToken === undefined) {
      delete process.env.dolphin_api_token
    } else {
      process.env.dolphin_api_token = previousToken
    }
  }

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://localhost:3001/v1.0/auth/login-with-token')
  assert.deepEqual(JSON.parse(calls[0].body || '{}'), {
    token: 'local-token-test'
  })
}

testHealthyResponsePasses()
testInvalidSessionFailsWithRepairMessage()
testTokenRefreshTimeoutFailsWithRepairMessage()
testOtherBadResponseFailsAsHealthCheck()
testDolphinAppRunningStoresLocalApiToken()
  .then(() => {
    console.log('dolphin preflight tests passed')
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
