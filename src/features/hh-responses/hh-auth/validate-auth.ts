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

async function hasBodyTextMatch(page: any, patterns: RegExp[]): Promise<boolean> {
  try {
    return await page.evaluate((sources: string[]) => {
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
      const bodyText = normalize(document.body?.innerText || '')

      return sources.some(source => new RegExp(source, 'i').test(bodyText))
    }, patterns.map(pattern => pattern.source))
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

async function getFastCaptchaSignals(page: any): Promise<{
  ddosGuard: boolean
  hhCaptchaChallenge: boolean
  captchaContainer: boolean
  captchaChallenge: boolean
}> {
  const fastTimeoutMs = 250
  const [ddosGuard, hhCaptchaChallenge, captchaContainer, captchaChallenge] =
    await Promise.all([
      page.evaluate(() => {
        return (
          /^ddos-guard$/i.test(document.title.trim()) ||
          /\bddos-guard\b/i.test(document.body?.innerText ?? '')
        )
      }).catch(() => false),
      hasHhCaptchaChallenge(page),
      isAttached(page, hhAuthSelectors.captcha.container, fastTimeoutMs),
      isAttached(page, hhAuthSelectors.captcha.challenge, fastTimeoutMs)
    ])

  return {
    ddosGuard,
    hhCaptchaChallenge,
    captchaContainer,
    captchaChallenge
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
  const fastCaptchaSignals = await getFastCaptchaSignals(page)

  if (
    fastCaptchaSignals.ddosGuard ||
    fastCaptchaSignals.hhCaptchaChallenge ||
    fastCaptchaSignals.captchaContainer ||
    fastCaptchaSignals.captchaChallenge
  ) {
    const result: HHAuthResult = {
      state: 'captcha',
      checkedAt: new Date().toISOString(),
      url: page.url(),
      title: await page.title().catch(() => ''),
      signals: {
        resumesAndProfile: false,
        loginButton: false,
        accountTypeCards: false,
        phoneInput: false,
        emailInput: false,
        passwordInput: false,
        vacancyResponsesButton: false,
        mainmenuProfileAndResumes: false,
        mainmenuVacancyResponses: false,
        applicantResumesLink: false,
        applicantNegotiationsLink: false,
        resumesAndProfileText: false,
        vacancyResponsesText: false,
        loggedInBodyText: false,
        loggedOutBodyText: false,
        loggedInEscapedBodyText: false,
        loggedOutEscapedBodyText: false,
        ...fastCaptchaSignals,
        loginUrl: isLoginUrl,
        loginUrlHasBackUrl
      }
    }

    options.log?.('validateAuth completed', result)

    return result
  }

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
    applicantResumesLink,
    applicantNegotiationsLink,
    resumesAndProfileText,
    vacancyResponsesText,
    loggedInBodyText,
    loggedOutBodyText,
    loggedInEscapedBodyText,
    loggedOutEscapedBodyText,
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
    isAttached(page, '[href*="/applicant/resumes"]', signalTimeoutMs),
    isAttached(page, '[href*="/applicant/negotiations"]', signalTimeoutMs),
    hasVisibleText(page, 'Резюме и профиль'),
    hasVisibleText(page, 'Отклики'),
    hasBodyTextMatch(page, [
      /Резюме и профиль/,
      /Мои резюме/,
      /Отклики/,
      /Responses/,
      /My resumes/
    ]),
    hasBodyTextMatch(page, [
      /Войти/,
      /Зарегистрироваться/,
      /Login/,
      /Sign up/
    ]),
    hasBodyTextMatch(page, [
      /\u0420\u0435\u0437\u044e\u043c\u0435 \u0438 \u043f\u0440\u043e\u0444\u0438\u043b\u044c/,
      /\u041c\u043e\u0438 \u0440\u0435\u0437\u044e\u043c\u0435/,
      /\u041e\u0442\u043a\u043b\u0438\u043a\u0438/
    ]),
    hasBodyTextMatch(page, [
      /\u0412\u043e\u0439\u0442\u0438/,
      /\u0417\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c\u0441\u044f/
    ]),
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
    applicantResumesLink,
    applicantNegotiationsLink,
    resumesAndProfileText,
    vacancyResponsesText,
    loggedInBodyText,
    loggedOutBodyText,
    loggedInEscapedBodyText,
    loggedOutEscapedBodyText,
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
    signals.applicantResumesLink ||
    signals.applicantNegotiationsLink ||
    signals.resumesAndProfileText ||
    signals.vacancyResponsesText ||
    signals.loggedInBodyText ||
    signals.loggedInEscapedBodyText
  ) {
    state = 'logged_in'
  } else if (
    signals.loginButton ||
    signals.accountTypeCards ||
    signals.phoneInput ||
    signals.emailInput ||
    signals.passwordInput ||
    signals.loginUrl ||
    signals.loggedOutBodyText ||
    signals.loggedOutEscapedBodyText
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
