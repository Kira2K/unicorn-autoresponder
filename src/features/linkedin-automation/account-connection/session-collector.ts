const { loadPlaywright } = require('../../../platform/browser/playwright.ts') as {
  loadPlaywright(): any
}
const { startDolphinProfile, stopDolphinProfile } =
  require('../../../integrations/dolphin/index.ts') as {
  startDolphinProfile(id: number): Promise<any>
  stopDolphinProfile(id: number): Promise<void>
}
const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}
const { acquireLinkedInProfileLock } = require('./profile-lock.ts') as {
  acquireLinkedInProfileLock(id: number): Promise<{ release(): Promise<void> }>
}
const { resolveOrPromptLinkedInProxy } = require('./proxy-notifier.ts') as {
  resolveOrPromptLinkedInProxy(id: number): Promise<any>
}
const { extractLinkedInSession } = require('./session-cookie.ts') as {
  extractLinkedInSession(input: any): any
}
const { readLinkedInPageIdentity } = require('./page-identity.ts') as {
  readLinkedInPageIdentity(page: any): Promise<{ profileUrl: string; userAgent: string }>
}
const { assertDolphinAppRunning } = require('../../../integrations/dolphin/preflight.ts') as {
  assertDolphinAppRunning(): Promise<void>
}
const { linkedInDolphinLocalError } = require('./dolphin-local-error.ts') as {
  linkedInDolphinLocalError(error: unknown): unknown
}
const { NOOP_AUTH_LOGGER } = require('./auth-logger.ts') as {
  NOOP_AUTH_LOGGER: import('./auth-logger.ts').AuthLogger
}
const PROFILE_URL = 'https://www.linkedin.com/in/me/'
type AuthLogger = import('./auth-logger.ts').AuthLogger
type CollectorDependencies = {
  checkLocalApi(): Promise<void>
  acquireLock(id: number): Promise<{ release(): Promise<void> }>
  getProxy(id: number): Promise<any>
  startProfile(id: number): Promise<any>
  stopProfile(id: number): Promise<void>
  playwright(): any
}
const defaults: CollectorDependencies = {
  checkLocalApi: assertDolphinAppRunning,
  acquireLock: acquireLinkedInProfileLock,
  getProxy: resolveOrPromptLinkedInProxy,
  startProfile: startDolphinProfile,
  stopProfile: stopDolphinProfile,
  playwright: loadPlaywright
}
async function collectLinkedInSession(
  profileId: number,
  expectedLinkedInUrl: string,
  dependencies: CollectorDependencies = defaults,
  logger: AuthLogger = NOOP_AUTH_LOGGER
) {
  const details = { dolphinProfileId: profileId }
  await logger.run('dolphin_local_api_checked', details, async () => {
    try { await dependencies.checkLocalApi() }
    catch (error) { throw linkedInDolphinLocalError(error) }
  })
  const lock = await logger.run(
    'profile_lock_acquired', details, () => dependencies.acquireLock(profileId)
  )
  let browser: any
  try {
    await logger.run('profile_stopped', details, () => dependencies.stopProfile(profileId))
    const proxy = await logger.run('proxy_validated', details, () => dependencies.getProxy(profileId))
    logger.event('proxy_summary', 'succeeded', {
      ...details, dolphinProtocol: proxy.protocol, authenticated: Boolean(proxy.username)
    })
    const port = await logger.run('profile_started', details, async () => {
      let started
      try { started = await dependencies.startProfile(profileId) }
      catch (error) { throw linkedInDolphinLocalError(error) }
      const value = Number(started?.automation?.port)
      if (!Number.isFinite(value) || value <= 0) {
        throw new LinkedInAuthError('dolphin_cdp_port_missing', 'Dolphin did not return a CDP port.')
      }
      return value
    })
    let context: any
    await logger.run('cdp_connected', details, async () => {
      browser = await dependencies.playwright().chromium.connectOverCDP(`http://127.0.0.1:${port}`)
      context = browser.contexts()[0]
      if (!context) {
        throw new LinkedInAuthError('dolphin_context_missing', 'Dolphin returned no browser context.')
      }
    })
    const page = await logger.run('linkedin_opened', details, async () => {
      const opened = context.pages()[0] ?? await context.newPage()
      await opened.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      return opened
    })
    const session = await logger.run('session_validated', details, async () => {
      const [cookies, identity] = await Promise.all([
        context.cookies('https://www.linkedin.com'), readLinkedInPageIdentity(page)
      ])
      return extractLinkedInSession({ cookies, ...identity, expectedLinkedInUrl })
    })
    logger.event('session_summary', 'succeeded', {
      ...details, cookiePresent: true, userAgentPresent: true, ownerMatched: true
    })
    return { proxy, session }
  } finally {
    if (browser) await logger.run('cdp_closed', details, () => browser.close()).catch(() => undefined)
    await logger.run(
      'profile_cleanup_stopped', details, () => dependencies.stopProfile(profileId)
    ).catch(() => undefined)
    await logger.run('profile_lock_released', details, () => lock.release())
  }
}
module.exports = { PROFILE_URL, collectLinkedInSession }
