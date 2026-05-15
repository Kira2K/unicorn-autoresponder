import type { HHAuthResult, HHAuthState, ValidateAuthOptions } from './types.js'

const { hhAuthSelectors } = require('./auth-selectors.ts')

const HH_HOME_URL = 'https://hh.ru/'
const DEFAULT_VALIDATE_TIMEOUT_MS = 7000
const MAX_SIGNAL_TIMEOUT_MS = 2500

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

async function hasVisibleText(page: any, text: string): Promise<boolean> {
  try {
    return await page.evaluate((expectedText: string) => {
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
      const targetText = normalize(expectedText)

      return Array.from(document.querySelectorAll('a, button, span, div')).some(
        element => normalize(element.textContent || '').includes(targetText)
      )
    }, text)
  } catch {
    return false
  }
}

async function hasHhCaptchaChallenge(page: any): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
      const bodyText = normalize(document.body?.innerText || '')

      if (
        bodyText.includes('Пройдите капчу') ||
        bodyText.includes('введите текст с картинки') ||
        bodyText.includes('Текст с картинки')
      ) {
        return true
      }

      return Array.from(document.querySelectorAll('input')).some(input => {
        const placeholder = input.getAttribute('placeholder') || ''
        const ariaLabel = input.getAttribute('aria-label') || ''

        return /текст с картинки|captcha|капч/i.test(`${placeholder} ${ariaLabel}`)
      })
    })
  } catch {
    return false
  }
}

async function ensureHhPage(page: any, timeoutMs: number): Promise<void> {
  const isHhUrl = (value: string) => /^https:\/\/([^/]+\.)?hh\.ru\//i.test(value)
  const url = String(page.url?.() ?? '')

  if (isHhUrl(url)) {
    return
  }

  let navigationError: unknown

  await page.goto(HH_HOME_URL, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs
  }).catch((error: unknown) => {
    navigationError = error
  })
  await page.waitForLoadState('load', {
    timeout: timeoutMs
  }).catch(() => undefined)
  await page.waitForTimeout(1000)

  if (navigationError && !isHhUrl(String(page.url?.() ?? ''))) {
    throw navigationError
  }
}

async function validateAuth(page: any, options: ValidateAuthOptions = {}): Promise<HHAuthResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_VALIDATE_TIMEOUT_MS
  const signalTimeoutMs = Math.min(timeoutMs, MAX_SIGNAL_TIMEOUT_MS)

  await ensureHhPage(page, timeoutMs)
  const currentUrl = String(page.url?.() ?? '')
  const isLoginUrl = /^https:\/\/([^/]+\.)?hh\.ru\/account\/login/i.test(currentUrl)
  const loginUrlHasBackUrl = isLoginUrl && /[?&]backUrl=/i.test(currentUrl)

  const [
    resumesAndProfile,
    loginButton,
    accountTypeCards,
    phoneInput,
    emailInput,
    passwordInput,
    vacancyResponsesButton,
    mainmenuProfileAndResumes,
    mainmenuVacancyResponses,
    resumesAndProfileText,
    vacancyResponsesText,
    ddosGuard,
    hhCaptchaChallenge,
    captchaContainer,
    captchaChallenge
  ] = await Promise.all([
    isAttached(page, hhAuthSelectors.navigation.resumesAndProfile, signalTimeoutMs),
    isAttached(page, hhAuthSelectors.loginForm.loginButton, signalTimeoutMs),
    isAttached(page, hhAuthSelectors.loginForm.accountTypeCards, signalTimeoutMs),
    isAttached(page, hhAuthSelectors.loginForm.phone, signalTimeoutMs),
    isAttached(page, hhAuthSelectors.loginForm.email, signalTimeoutMs),
    isAttached(page, hhAuthSelectors.loginForm.password, signalTimeoutMs),
    isAttached(page, '[data-qa="vacancyResponses-button"]', signalTimeoutMs),
    isAttached(page, '[data-qa="mainmenu_profileAndResumes"]', signalTimeoutMs),
    isAttached(page, '[data-qa="mainmenu_vacancyResponses"]', signalTimeoutMs),
    hasVisibleText(page, 'Резюме и профиль'),
    hasVisibleText(page, 'Отклики'),
    page.evaluate(() => {
      return (
        /^ddos-guard$/i.test(document.title.trim()) ||
        /\bddos-guard\b/i.test(document.body?.innerText ?? '')
      )
    }).catch(() => false),
    hasHhCaptchaChallenge(page),
    isAttached(page, hhAuthSelectors.captcha.container, signalTimeoutMs),
    isAttached(page, hhAuthSelectors.captcha.challenge, signalTimeoutMs)
  ])

  const signals = {
    resumesAndProfile,
    loginButton,
    accountTypeCards,
    phoneInput,
    emailInput,
    passwordInput,
    vacancyResponsesButton,
    mainmenuProfileAndResumes,
    mainmenuVacancyResponses,
    resumesAndProfileText,
    vacancyResponsesText,
    ddosGuard,
    hhCaptchaChallenge,
    captchaContainer,
    captchaChallenge,
    loginUrl: isLoginUrl,
    loginUrlHasBackUrl
  }
  let state: HHAuthState = 'unknown'

  if (
    signals.ddosGuard ||
    signals.hhCaptchaChallenge ||
    signals.captchaContainer ||
    signals.captchaChallenge
  ) {
    state = 'captcha'
  } else if (
    signals.resumesAndProfile ||
    signals.vacancyResponsesButton ||
    signals.mainmenuProfileAndResumes ||
    signals.mainmenuVacancyResponses ||
    signals.resumesAndProfileText ||
    signals.vacancyResponsesText
  ) {
    state = 'logged_in'
  } else if (
    signals.loginButton ||
    signals.accountTypeCards ||
    signals.phoneInput ||
    signals.emailInput ||
    signals.passwordInput ||
    signals.loginUrl
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
