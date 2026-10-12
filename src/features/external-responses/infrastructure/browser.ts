import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { BrowserContext } from 'playwright'
import { prepareBrowserProfile } from './browser-profile.ts'
import { isLinkedInUrl } from './navigation-policy.ts'
const require = createRequire(import.meta.url)
const { loadPlaywright } = require('../../../platform/browser/playwright.ts')

export type BrowserDriver = 'playwright' | 'patchright'
export type BrowserSessionInfo = { sessionId: string; driver: BrowserDriver; driverVersion: string; browserVersion: string; profilePath: string; backupPath?: string; headless: boolean }
export function parseBrowserDriver(value = 'playwright'): BrowserDriver {
  if (value !== 'playwright' && value !== 'patchright') throw Error(`Unsupported browser driver: ${value}`)
  return value
}
function loadDriver(driver: BrowserDriver) {
  const library = driver === 'patchright' ? require('patchright') : loadPlaywright()
  return { chromium: library.chromium, version: require(`${driver}/package.json`).version as string }
}
export function preflightBrowser(driver: BrowserDriver) {
  const library=loadDriver(driver)
  if(!existsSync(library.chromium.executablePath())) throw Error('requested_browser_executable_missing')
  return {driver,version:library.version}
}

export async function createBrowserSession(options: { profilePath: string; headless?: boolean; driver?: BrowserDriver; onSession?: (info: BrowserSessionInfo) => void | Promise<void> }, deps = { loadDriver, prepareProfile: prepareBrowserProfile }): Promise<BrowserContext> {
  const driver = parseBrowserDriver(options.driver), profilePath = resolve(options.profilePath)
  const profile = await deps.prepareProfile({ profilePath, driver })
  let context: BrowserContext | undefined
  try {
    const library = deps.loadDriver(driver)
    context = await library.chromium.launchPersistentContext(profilePath, {
      headless: options.headless ?? false, viewport: driver === 'patchright' ? null : { width: 1440, height: 1050 }, acceptDownloads: false
    })
    await context!.route('**/*',route=>isLinkedInUrl(route.request().url())?route.abort():route.continue())
    const close = context!.close.bind(context)
    context!.close = async options => { try { await close(options) } finally { await profile.release() } }
    context!.on('close', () => { void profile.release().catch(() => {}) })
    await options.onSession?.({ sessionId: randomUUID(), driver, driverVersion: library.version, browserVersion: context!.browser()!.version(), profilePath, backupPath: profile.backupPath, headless: options.headless ?? false })
    return context!
  } catch (error: any) {
    await context?.close().catch(() => {}); await profile.release()
    throw Error(`Could not start ${driver} browser: ${error.message ?? error}`, { cause: error })
  }
}
