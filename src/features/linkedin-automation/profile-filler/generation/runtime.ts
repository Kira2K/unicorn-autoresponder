const { getDolphinProfileWithProxy } = require('../../../../integrations/dolphin/profile-proxy.ts') as {
  getDolphinProfileWithProxy(profileId: number): Promise<any>
}
const { assertDriveCredentials, generationConfig } = require('./config.ts') as
  typeof import('./config.ts')
const { loadDriveCv } = require('./drive-cv.ts') as typeof import('./drive-cv.ts')
const { createProfileGenerator } = require('./openai-generator.ts') as typeof import('./openai-generator.ts')
const { resolveProxyCountry } = require('./proxy-country.ts') as typeof import('./proxy-country.ts')

function createGenerationRuntime(overrides: any = {}, logger?: any) {
  const config = overrides.config ?? generationConfig(overrides.env)
  const generator = overrides.generator ?? createProfileGenerator({
    apiKey: config.apiKey, model: config.model, timeoutMs: config.openAiTimeoutMs,
    maxOutputTokens: config.maxOutputTokens, fetchImpl: overrides.openAiFetch,
    baseUrl: overrides.openAiBaseUrl, logger: overrides.logger ?? logger,
    retrySleep: overrides.retrySleep, retryRandom: overrides.retryRandom
  })
  return {
    config,
    loadCv: overrides.loadCv ?? ((url: string) => {
      assertDriveCredentials(config.credentialsFile)
      return loadDriveCv(url, config.driveMaxBytes)
    }),
    loadProfile: overrides.loadProfile ?? getDolphinProfileWithProxy,
    resolveCountry: overrides.resolveCountry ?? ((proxy: any) => resolveProxyCountry(proxy, {
      baseUrl: config.geoBaseUrl, timeoutMs: config.geoTimeoutMs, fetchImpl: overrides.geoFetch
    })),
    generator
  }
}

module.exports = { createGenerationRuntime }
