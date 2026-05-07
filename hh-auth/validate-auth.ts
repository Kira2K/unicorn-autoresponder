import type { HHAuthResult, HHAuthState, ValidateAuthOptions } from './types.js'

const { hhAuthSelectors } = require('./auth-selectors.ts')

const HH_HOME_URL = 'https://hh.ru/'
const DEFAULT_VALIDATE_TIMEOUT_MS = 7000

async function isAttached(page: any, selector: string, timeoutMs: number): Promise<boolean> {
  if (!selector) {
    return false
  }

  try {
    const locator = page.locator(selector).first()
    await locator.waitFor({
      state: 'attached',
      timeout: timeoutMs
    })

    return await locator.count() > 0
  } catch {
    return false
  }
}

async function ensureHhPage(page: any, timeoutMs: number): Promise<void> {
  const url = String(page.url?.() ?? '')

  if (/^https:\/\/([^/]+\.)?hh\.ru\//i.test(url)) {
    return
  }

  await page.goto(HH_HOME_URL, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs
  })
  await page.waitForLoadState('load', {
    timeout: timeoutMs
  }).catch(() => undefined)
  await page.waitForTimeout(1000)
}

async function validateAuth(page: any, options: ValidateAuthOptions = {}): Promise<HHAuthResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_VALIDATE_TIMEOUT_MS

  await ensureHhPage(page, timeoutMs)

  const signals = {
    resumesAndProfile: await isAttached(page, hhAuthSelectors.navigation.resumesAndProfile, timeoutMs),
    loginButton: await isAttached(page, hhAuthSelectors.loginForm.loginButton, timeoutMs),
    accountTypeCards: await isAttached(page, hhAuthSelectors.loginForm.accountTypeCards, timeoutMs),
    phoneInput: await isAttached(page, hhAuthSelectors.loginForm.phone, timeoutMs),
    emailInput: await isAttached(page, hhAuthSelectors.loginForm.email, timeoutMs),
    passwordInput: await isAttached(page, hhAuthSelectors.loginForm.password, timeoutMs),
    captchaContainer: await isAttached(page, hhAuthSelectors.captcha.container, timeoutMs),
    captchaChallenge: await isAttached(page, hhAuthSelectors.captcha.challenge, timeoutMs)
  }
  let state: HHAuthState = 'unknown'

  if (signals.captchaContainer || signals.captchaChallenge) {
    state = 'captcha'
  } else if (signals.resumesAndProfile) {
    state = 'logged_in'
  } else if (
    signals.loginButton ||
    signals.accountTypeCards ||
    signals.phoneInput ||
    signals.emailInput ||
    signals.passwordInput ||
    /^https:\/\/([^/]+\.)?hh\.ru\/account\/login/i.test(page.url())
  ) {
    state = 'logged_out'
  }

  const result: HHAuthResult = {
    state,
    checkedAt: new Date().toISOString(),
    url: page.url(),
    title: await page.title().catch(() => ''),
    signals
  }

  options.log?.('validateAuth completed', result)

  return result
}

module.exports = {
  validateAuth
}
