const { loadPlaywright } = require('../../../platform/browser/playwright.ts') as {
  loadPlaywright(): any
}
const {
  startDolphinProfile,
  stopDolphinProfile
} = require('../../../integrations/dolphin/index.ts') as {
  startDolphinProfile(id: number): Promise<any>
  stopDolphinProfile(id: number): Promise<void>
}
const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}
const { acquireLinkedInProfileLock } = require('./profile-lock.ts') as {
  acquireLinkedInProfileLock(id: number): Promise<{ release(): Promise<void> }>
}
const { resolveOrPromptLinkedInProxy } = require('./proxy-recovery.ts') as {
  resolveOrPromptLinkedInProxy(id: number): Promise<any>
}
const { extractLinkedInSession } = require('./session-cookie.ts') as {
  extractLinkedInSession(input: any): any
}
const { readLinkedInPageIdentity } = require('./page-identity.ts') as {
  readLinkedInPageIdentity(page: any): Promise<{ profileUrl: string; userAgent: string }>
}

const PROFILE_URL = 'https://www.linkedin.com/in/me/'
type CollectorDependencies = {
  acquireLock(id: number): Promise<{ release(): Promise<void> }>
  getProxy(id: number): Promise<any>
  startProfile(id: number): Promise<any>
  stopProfile(id: number): Promise<void>
  playwright(): any
}

const defaults: CollectorDependencies = {
  acquireLock: acquireLinkedInProfileLock,
  getProxy: resolveOrPromptLinkedInProxy,
  startProfile: startDolphinProfile,
  stopProfile: stopDolphinProfile,
  playwright: loadPlaywright
}

async function collectLinkedInSession(
  profileId: number,
  expectedLinkedInUrl: string,
  dependencies: CollectorDependencies = defaults
) {
  const lock = await dependencies.acquireLock(profileId)
  let browser: any

  try {
    await dependencies.stopProfile(profileId)
    const proxy = await dependencies.getProxy(profileId)
    const started = await dependencies.startProfile(profileId)
    const port = Number(started?.automation?.port)
    if (!Number.isFinite(port) || port <= 0) {
      throw new LinkedInAuthError('dolphin_cdp_port_missing', 'Dolphin did not return a CDP port.')
    }

    browser = await dependencies.playwright().chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    if (!context) {
      throw new LinkedInAuthError('dolphin_context_missing', 'Dolphin returned no browser context.')
    }
    const page = context.pages()[0] ?? await context.newPage()
    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const [cookies, identity] = await Promise.all([
      context.cookies('https://www.linkedin.com'),
      readLinkedInPageIdentity(page)
    ])
    const session = extractLinkedInSession({
      cookies, ...identity, expectedLinkedInUrl
    })
    return { proxy, session }
  } finally {
    await browser?.close?.().catch(() => undefined)
    await dependencies.stopProfile(profileId).catch(() => undefined)
    await lock.release()
  }
}

module.exports = { PROFILE_URL, collectLinkedInSession }
