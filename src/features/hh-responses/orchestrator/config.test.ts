const assert = require('node:assert/strict')

const CONFIG_PATH = require.resolve('./config.ts')

function withEnv<T>(
  patch: Record<string, string | undefined>,
  callback: () => T
): T {
  const previous: Record<string, string | undefined> = {}

  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key]

    if (patch[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = patch[key]
    }
  }

  delete require.cache[CONFIG_PATH]

  try {
    return callback()
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previous[key]
      }
    }

    delete require.cache[CONFIG_PATH]
  }
}

function loadConfig(patch: Record<string, string | undefined>) {
  return withEnv(patch, () => require('./config.ts'))
}

function testResponseLimitDoesNotDisableDefaultWatch(): void {
  const config = loadConfig({
    ORCHESTRATOR_RESPONSE_LIMIT: '5',
    ORCHESTRATOR_WATCH_MS: undefined
  })

  assert.equal(config.AUTO_RESPONDER_WATCH_MS, config.DEFAULT_WATCH_MS)
  assert.equal(config.ORCHESTRATOR_RESPONSE_LIMIT, 5)
}

function testExplicitWatchStillOverridesDefaultWatch(): void {
  const config = loadConfig({
    ORCHESTRATOR_RESPONSE_LIMIT: '5',
    ORCHESTRATOR_WATCH_MS: '1234'
  })

  assert.equal(config.AUTO_RESPONDER_WATCH_MS, 1234)
}

function testExplicitWatchCanBeDisabled(): void {
  const config = loadConfig({
    ORCHESTRATOR_RESPONSE_LIMIT: '5',
    ORCHESTRATOR_WATCH_MS: 'disabled'
  })

  assert.equal(config.AUTO_RESPONDER_WATCH_MS, undefined)
}

function testOrchestratorConcurrencyDefaultsToOne(): void {
  const config = loadConfig({
    ORCHESTRATOR_CONCURRENCY: undefined
  })

  assert.equal(config.ORCHESTRATOR_CONCURRENCY, 1)
}

function testOrchestratorConcurrencyIsPositiveInteger(): void {
  assert.equal(
    loadConfig({ ORCHESTRATOR_CONCURRENCY: '2.8' }).ORCHESTRATOR_CONCURRENCY,
    2
  )
  assert.equal(
    loadConfig({ ORCHESTRATOR_CONCURRENCY: '0' }).ORCHESTRATOR_CONCURRENCY,
    1
  )
  assert.equal(
    loadConfig({ ORCHESTRATOR_CONCURRENCY: 'not-a-number' }).ORCHESTRATOR_CONCURRENCY,
    1
  )
}

testResponseLimitDoesNotDisableDefaultWatch()
testExplicitWatchStillOverridesDefaultWatch()
testExplicitWatchCanBeDisabled()
testOrchestratorConcurrencyDefaultsToOne()
testOrchestratorConcurrencyIsPositiveInteger()

console.log('orchestrator config tests passed')
