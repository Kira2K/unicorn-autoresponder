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

function testSupervisedAndIdleTimeoutConfig(): void {
  const config = loadConfig({
    ORCHESTRATOR_SUPERVISED: 'true',
    ORCHESTRATOR_IDLE_TIMEOUT_MS: '12345'
  })

  assert.equal(config.ORCHESTRATOR_SUPERVISED, true)
  assert.equal(config.ORCHESTRATOR_IDLE_TIMEOUT_MS, 12345)
}

function testIdleTimeoutDefaultsToTenMinutes(): void {
  const config = loadConfig({
    ORCHESTRATOR_IDLE_TIMEOUT_MS: undefined
  })

  assert.equal(
    config.ORCHESTRATOR_IDLE_TIMEOUT_MS,
    config.DEFAULT_ORCHESTRATOR_IDLE_TIMEOUT_MS
  )
}

function testOrchestratorConcurrencyDefaultsToOneWhenUnsupervised(): void {
  const config = loadConfig({
    ORCHESTRATOR_SUPERVISED: undefined,
    ORCHESTRATOR_CONCURRENCY: undefined
  })

  assert.equal(config.ORCHESTRATOR_CONCURRENCY, 1)
}

function testSupervisedOrchestratorConcurrencyDefaultsToThree(): void {
  const config = loadConfig({
    ORCHESTRATOR_SUPERVISED: 'true',
    ORCHESTRATOR_CONCURRENCY: undefined
  })

  assert.equal(
    config.ORCHESTRATOR_CONCURRENCY,
    config.DEFAULT_SUPERVISED_ORCHESTRATOR_CONCURRENCY
  )
  assert.equal(config.ORCHESTRATOR_CONCURRENCY, 3)
}

function testOrchestratorConcurrencyIsPositiveInteger(): void {
  assert.equal(
    loadConfig({
      ORCHESTRATOR_SUPERVISED: 'true',
      ORCHESTRATOR_CONCURRENCY: '2.8'
    }).ORCHESTRATOR_CONCURRENCY,
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

function testMarketConfigParsesEn(): void {
  const config = loadConfig({
    ORCHESTRATOR_WORK_WITH_MARKET: 'en'
  })

  assert.equal(config.ORCHESTRATOR_WORK_WITH_MARKET, 'En')
}

function testMarketConfigRejectsInvalidValue(): void {
  assert.throws(
    () =>
      loadConfig({
        ORCHESTRATOR_WORK_WITH_MARKET: 'all'
      }),
    /Invalid ORCHESTRATOR_WORK_WITH_MARKET/
  )
}

testResponseLimitDoesNotDisableDefaultWatch()
testExplicitWatchStillOverridesDefaultWatch()
testExplicitWatchCanBeDisabled()
testSupervisedAndIdleTimeoutConfig()
testIdleTimeoutDefaultsToTenMinutes()
testOrchestratorConcurrencyDefaultsToOneWhenUnsupervised()
testSupervisedOrchestratorConcurrencyDefaultsToThree()
testOrchestratorConcurrencyIsPositiveInteger()
testMarketConfigParsesEn()
testMarketConfigRejectsInvalidValue()

console.log('orchestrator config tests passed')
