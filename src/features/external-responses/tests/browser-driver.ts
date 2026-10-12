import { createRequire } from 'node:module'
import type { LaunchOptions, Browser } from 'playwright'

const require = createRequire(import.meta.url)
/** Explicit fixture driver/channel; no browser download, profile attachment or silent fallback. */
export function launchFixtureBrowser(options: LaunchOptions = {}): Promise<Browser> {
  const driver = process.env.EXTERNAL_RESPONSES_TEST_DRIVER ?? 'playwright'
  if (!['playwright', 'patchright'].includes(driver)) throw Error('invalid_test_browser_driver')
  const library = driver === 'patchright' ? require('patchright') : require('../../../platform/browser/playwright.ts').loadPlaywright()
  return library.chromium.launch({ headless: true, ...options,
    ...(process.env.EXTERNAL_RESPONSES_TEST_CHANNEL ? { channel: process.env.EXTERNAL_RESPONSES_TEST_CHANNEL } : {}) })
}
