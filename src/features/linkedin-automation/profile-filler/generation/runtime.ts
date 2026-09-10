const { getDolphinProfileWithProxy } = require('../../../../integrations/dolphin/profile-proxy.ts') as {
  getDolphinProfileWithProxy(profileId: number): Promise<any>
}
const { assertDriveCredentials, generationConfig } = require('./config.ts') as
  typeof import('./config.ts')
const { loadDriveCv } = require('./drive-cv.ts') as typeof import('./drive-cv.ts')
const { createProfileGenerator } = require('./openai-generator.ts') as typeof import('./openai-generator.ts')
const { resolveProxyCountry } = require('./proxy-country.ts') as typeof import('./proxy-country.ts')
const { preparationCall, preparationWait, checkPreparation } = require('./cancellation.ts') as
  typeof import('./cancellation.ts')
type Job = import('../job-types.ts').ProfileJob
type Generator = ReturnType<typeof createProfileGenerator>

function createGenerationRuntime(overrides: any = {}, logger?: any, job?: Job) {
  const config = overrides.config ?? generationConfig(overrides.env)
  const guardedFetch: typeof fetch = (url, init) => {
    // Let an in-flight call settle; DELETE remains available to clean up the uploaded CV.
    if (job && init?.method !== 'DELETE') checkPreparation(job)
    return (overrides.openAiFetch ?? fetch)(url, init)
  }
  const generator = overrides.generator ?? createProfileGenerator({
    apiKey: config.apiKey, model: config.model, timeoutMs: config.openAiTimeoutMs,
    maxOutputTokens: config.maxOutputTokens, fetchImpl: guardedFetch,
    baseUrl: overrides.openAiBaseUrl, logger: overrides.logger ?? logger,
    retrySleep: job ? (ms: number) => preparationWait(job, ms, overrides.retrySleep) : overrides.retrySleep,
    retryRandom: overrides.retryRandom
  })
  const guard = <A extends unknown[], R>(method: (...args: A) => R) =>
    (...args: A) => job ? preparationCall(job, () => method.apply(generator, args)) : method.apply(generator, args)
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
    generator: {
      extractFacts: guard(generator.extractFacts as Generator['extractFacts']),
      generateProfile: guard(generator.generateProfile as Generator['generateProfile']),
      ...(generator.repairProfile ? { repairProfile: guard(generator.repairProfile as Generator['repairProfile']) } : {}),
      ...(generator.chooseJobTitles ? { chooseJobTitles: guard(generator.chooseJobTitles as Generator['chooseJobTitles']) } : {})
    }
  }
}

module.exports = { createGenerationRuntime }
