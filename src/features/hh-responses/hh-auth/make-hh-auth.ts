import type { AuthorizeHHPageOptions, HHAuthResult, HHAuthStepResult, HHCredentials, MakeHHAuthOptions, StartedProfile } from './types.js'

const { hhAuthSelectors } = require('./auth-selectors.ts')
const { validateAuth } = require('./validate-auth.ts')
const {
  collectDataQa,
  selectorExists,
  takeScreenshot
} = require('./utils/index.ts')

class HHAuthError extends Error {
  code: string
  details?: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'HHAuthError'
    this.code = code
    this.details = details
  }
}

async function waitForAuthSelector(
  page: any,
  selector: string,
  step: string,
  options: AuthorizeHHPageOptions
): Promise<any> {
  const authStateBeforeWait: HHAuthResult = await validateAuth(page, {
    log: options.log,
    timeoutMs: Math.min(options.timeoutMs ?? 30000, 1000)
  })

  if (authStateBeforeWait.state === 'captcha') {
    throw new HHAuthError(
      'captcha_detected',
      `HH captcha detected before waiting for auth selector at ${step}`,
      authStateBeforeWait
    )
  }

  const locator = page.locator(selector).first()

  try {
    await locator.waitFor({
      state: 'attached',
      timeout: options.timeoutMs
    })

    return locator
  } catch (error: unknown) {
    const authStateAfterWait: HHAuthResult = await validateAuth(page, {
      log: options.log,
      timeoutMs: Math.min(options.timeoutMs ?? 30000, 1000)
    }).catch(() => undefined as unknown as HHAuthResult)

    if (authStateAfterWait?.state === 'captcha') {
      throw new HHAuthError(
        'captcha_detected',
        `HH captcha detected while waiting for auth selector at ${step}`,
        authStateAfterWait
      )
    }

    const dataQa = await collectDataQa(page)
    const screenshot = await takeScreenshot(page, options.artifactDir, `debug-${step}-selector-missing.png`)
      .catch((screenshotError: unknown) => {
        options.log?.('Auth debug screenshot failed', {
          step,
          error: screenshotError instanceof Error ? screenshotError.message : String(screenshotError)
        })

        return undefined
      })
    options.log?.('Auth selector missing', {
      step,
      selector,
      screenshot,
      dataQa
    })

    throw new HHAuthError('selector_missing', `HH auth selector was not found at ${step}: ${selector}`, {
      selector,
      step,
      screenshot,
      dataQa,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function fillAuthField(
  page: any,
  selector: string,
  step: string,
  value: string,
  options: AuthorizeHHPageOptions
): Promise<any> {
  const container = await waitForAuthSelector(page, selector, step, options)
  const nestedEditable = container.locator('input, textarea, [contenteditable="true"]').first()

  if (await nestedEditable.count().catch(() => 0)) {
    await nestedEditable.fill(value, {
      timeout: options.timeoutMs
    })

    return container
  }

  await container.fill(value, {
    timeout: options.timeoutMs
  })

  return container
}

async function ensureEmailLoginMode(
  page: any,
  options: AuthorizeHHPageOptions
): Promise<void> {
  if (await selectorExists(page, hhAuthSelectors.loginForm.email)) {
    return
  }

  if (await selectorExists(page, hhAuthSelectors.loginForm.emailCredentialType)) {
    const emailCredentialType = await waitForAuthSelector(
      page,
      hhAuthSelectors.loginForm.emailCredentialType,
      'email-credential-type',
      options
    )
    await emailCredentialType.check({
      force: true,
      timeout: options.timeoutMs
    }).catch(async () => {
      await emailCredentialType.click({
        force: true,
        timeout: options.timeoutMs
      })
    })
    await page.waitForTimeout(500)
  } else {
    const emailTab = page.getByText?.('Почта', { exact: true }).first()

    if (emailTab && (await emailTab.count().catch(() => 0))) {
      await emailTab.click({ timeout: options.timeoutMs })
      await page.waitForTimeout(500)
    }
  }

  await waitForAuthSelector(
    page,
    hhAuthSelectors.loginForm.email,
    'email-input',
    options
  )
}

async function ensureLoginFormOpen(
  page: any,
  options: AuthorizeHHPageOptions
): Promise<void> {
  const gotoHhAuthPage = async (url: string) => {
    let navigationError: unknown

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs
    }).catch((error: unknown) => {
      navigationError = error
    })
    await page.waitForLoadState('domcontentloaded', {
      timeout: options.timeoutMs
    }).catch(() => undefined)

    if (
      navigationError &&
      !/^https:\/\/([^/]+\.)?hh\.ru\//i.test(String(page.url?.() ?? ''))
    ) {
      throw navigationError
    }
  }
  const loginFormVisible = async () =>
    (await selectorExists(page, hhAuthSelectors.loginForm.phone)) ||
    (await selectorExists(page, hhAuthSelectors.loginForm.email)) ||
    (await selectorExists(page, hhAuthSelectors.loginForm.emailCredentialType)) ||
    (await selectorExists(page, hhAuthSelectors.loginForm.accountTypeCards))

  if (await loginFormVisible()) {
    return
  }

  if (await selectorExists(page, hhAuthSelectors.loginForm.loginButton)) {
    const loginButton = await waitForAuthSelector(
      page,
      hhAuthSelectors.loginForm.loginButton,
      'login-button',
      options
    )
    const loginHref = await loginButton
      .evaluate((element: Element) => element.getAttribute('href'))
      .catch(() => undefined)

    if (loginHref) {
      await gotoHhAuthPage(new URL(loginHref, 'https://hh.ru/').toString())
    } else {
      await loginButton.click({ timeout: options.timeoutMs })
    }

    await page.waitForLoadState('domcontentloaded', {
      timeout: options.timeoutMs
    }).catch(() => undefined)
    await page.waitForTimeout(1500)
  }

  if (await loginFormVisible()) {
    return
  }

  await gotoHhAuthPage('https://hh.ru/account/login')
  await page.waitForTimeout(1500)

  if (await loginFormVisible()) {
    return
  }

  throw new HHAuthError(
    'selector_missing',
    'HH login form did not open from the home page or direct login URL',
    {
      url: page.url(),
      dataQa: await collectDataQa(page)
    }
  )
}

async function openConnectedPage(options: MakeHHAuthOptions, profileId: number, mode: 'headless' | 'headfull'): Promise<{
  startedProfile: StartedProfile
  browser: any
  page: any
}> {
  const startedProfile = await options.startProfile(profileId, mode)
  const browser = await options.connectToProfile(startedProfile)
  const context = browser.contexts()[0] || await browser.newContext()
  const page = context.pages()[0] || await context.newPage()

  return {
    startedProfile,
    browser,
    page
  }
}

async function gotoHhHome(page: any, options: MakeHHAuthOptions): Promise<void> {
  let navigationError: unknown

  await page.goto('https://hh.ru/', {
    waitUntil: 'domcontentloaded',
    timeout: options.timeoutMs
  }).catch((error: unknown) => {
    navigationError = error
  })
  await page.waitForLoadState('domcontentloaded', {
    timeout: Math.min(options.timeoutMs ?? 30000, 5000)
  }).catch(() => undefined)

  if (
    navigationError &&
    !/^https:\/\/([^/]+\.)?hh\.ru\//i.test(String(page.url?.() ?? ''))
  ) {
    throw navigationError
  }
}

async function disconnectBrowser(browser: any): Promise<void> {
  if (!browser) {
    return
  }

  if (typeof browser.disconnect === 'function') {
    await browser.disconnect().catch(() => undefined)
    return
  }

  await browser.close?.().catch(() => undefined)
}

async function releaseStartedProfile(
  options: MakeHHAuthOptions,
  profileId: number,
  browser: any,
  waitBeforeStopMs = 0
): Promise<void> {
  await disconnectBrowser(browser)

  if (waitBeforeStopMs > 0) {
    await new Promise(resolve => setTimeout(resolve, waitBeforeStopMs))
  }

  await options.stopProfile(profileId).catch(() => undefined)
}

function assertLoggedIn(result: HHAuthResult, code: string): void {
  if (result.state === 'captcha') {
    throw new HHAuthError('captcha_detected', 'HH captcha detected during auth flow', result)
  }

  if (result.state !== 'logged_in') {
    throw new HHAuthError(code, `HH auth validation failed: ${result.state}`, result)
  }
}

function hasLoginBackUrl(result?: HHAuthResult): boolean {
  if (!result) {
    return false
  }

  return Boolean(
    result.signals?.loginUrlHasBackUrl ||
      (/^https:\/\/([^/]+\.)?hh\.ru\/account\/login/i.test(result.url) &&
        /[?&]backUrl=/i.test(result.url))
  )
}

async function performLoginOnPage(
  page: any,
  credentials: HHCredentials,
  options: AuthorizeHHPageOptions
): Promise<HHAuthResult> {
  await ensureLoginFormOpen(page, options)

  if (!await selectorExists(page, hhAuthSelectors.loginForm.phone)) {
    if (await selectorExists(page, hhAuthSelectors.loginForm.accountTypeCards)) {
      const accountTypeSubmit = await waitForAuthSelector(
        page,
        hhAuthSelectors.loginForm.submit,
        'account-type-submit-button',
        options
      )
      await accountTypeSubmit.click({ timeout: options.timeoutMs })
      await page.waitForLoadState('domcontentloaded', {
        timeout: options.timeoutMs
      }).catch(() => undefined)
      await page.waitForTimeout(1000)
    }
  }

  await ensureEmailLoginMode(page, options)

  await fillAuthField(
    page,
    hhAuthSelectors.loginForm.email,
    'email-input',
    credentials.email,
    options
  )
  await takeScreenshot(page, options.artifactDir, '02-auth-email-entered.png')
  await page.keyboard.press('Escape').catch(() => undefined)
  await page.waitForTimeout(500)

  const switchToPassword = await waitForAuthSelector(
    page,
    hhAuthSelectors.loginForm.switchToPassword,
    'switch-to-password',
    options
  )
  await switchToPassword.click({ timeout: options.timeoutMs })

  await fillAuthField(
    page,
    hhAuthSelectors.loginForm.password,
    'password-input',
    credentials.password,
    options
  )
  await takeScreenshot(page, options.artifactDir, '03-auth-password-entered.png')

  const submitButton = await waitForAuthSelector(
    page,
    hhAuthSelectors.loginForm.submit,
    'submit-button',
    options
  )
  await submitButton.click({ timeout: options.timeoutMs })
  await page.waitForLoadState('domcontentloaded', {
    timeout: options.timeoutMs
  }).catch(() => undefined)

  return await waitForAuthAfterSubmit(page, options)
}

async function waitForAuthAfterSubmit(
  page: any,
  options: AuthorizeHHPageOptions
): Promise<HHAuthResult> {
  const timeoutMs = Math.max(options.timeoutMs ?? 30000, 60000)
  const startedAt = Date.now()
  let latestResult: HHAuthResult | undefined

  while (Date.now() - startedAt < timeoutMs) {
    await page.waitForLoadState('domcontentloaded', {
      timeout: Math.min(options.timeoutMs ?? 30000, 5000)
    }).catch(() => undefined)
    await page.waitForTimeout(1000)

    const result: HHAuthResult = await validateAuth(page, {
      log: options.log,
      timeoutMs: Math.min(options.timeoutMs ?? 30000, 5000)
    })
    latestResult = result

    if (result.state === 'logged_in' || result.state === 'captcha') {
      return result
    }
  }

  if (latestResult) {
    return latestResult
  }

  return await validateAuth(page, {
    log: options.log,
    timeoutMs: Math.min(options.timeoutMs ?? 30000, 5000)
  })
}

async function resolveCredentials(options: MakeHHAuthOptions): Promise<HHCredentials> {
  if (options.getCredentials) {
    return await options.getCredentials()
  }

  if (options.credentials) {
    return options.credentials
  }

  throw new HHAuthError('missing_credentials', 'HH auth credentials provider is not configured')
}

async function resolvePageCredentials(options: AuthorizeHHPageOptions): Promise<HHCredentials> {
  if (options.getCredentials) {
    return await options.getCredentials()
  }

  if (options.credentials) {
    return options.credentials
  }

  throw new HHAuthError('missing_credentials', 'HH auth credentials provider is not configured')
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function takeAuthErrorScreenshot(
  page: any,
  options: AuthorizeHHPageOptions,
  step: string,
  error: unknown
): Promise<void> {
  const artifactDir = options.errorArtifactDir ?? options.artifactDir

  if (!artifactDir || !page || page.isClosed?.()) {
    return
  }

  const screenshot = await takeScreenshot(
    page,
    artifactDir,
    `error-${step}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
  ).catch((screenshotError: unknown) => {
    options.log?.('Auth error screenshot failed', {
      step,
      error: getErrorMessage(screenshotError)
    })

    return undefined
  })

  if (screenshot) {
    options.log?.('Auth error screenshot saved before closing profile', {
      step,
      screenshot,
      error: getErrorMessage(error)
    })
  }
}

async function authorizeHHPage(
  page: any,
  options: AuthorizeHHPageOptions
): Promise<HHAuthResult> {
  try {
    const initialResult: HHAuthResult = await validateAuth(page, {
      log: options.log,
      timeoutMs: options.timeoutMs
    })

    if (initialResult.state === 'logged_in') {
      return initialResult
    }

    if (initialResult.state === 'captcha') {
      throw new HHAuthError('captcha_detected', 'HH captcha detected before login', initialResult)
    }

    if (initialResult.state !== 'logged_out') {
      throw new HHAuthError('auth_unknown', `HH auth validation stayed ${initialResult.state}`, initialResult)
    }

    if (hasLoginBackUrl(initialResult)) {
      options.log?.('HH login backUrl detected; logging in on the already-open page', {
        url: initialResult.url
      })
    }

    const credentials = await resolvePageCredentials(options)
    const loginResult = await performLoginOnPage(page, credentials, options)
    assertLoggedIn(loginResult, 'login_failed')

    return loginResult
  } catch (error: unknown) {
    await takeAuthErrorScreenshot(page, options, 'existing-page-login', error)
    throw error
  }
}

function makeHHAuth(options: MakeHHAuthOptions) {
  async function ensureAuthorized(profileId: number): Promise<HHAuthStepResult> {
    let initialHeadless: HHAuthResult | undefined
    let headfullAfterLogin: HHAuthResult | undefined
    let finalHeadless: HHAuthResult | undefined
    let keepHeadlessRunning = false
    let keepHeadfullRunning = false
    let keepFinalHeadlessRunning = false

    let headless: {
      startedProfile: StartedProfile
      browser: any
      page: any
    } | undefined

    if (!options.skipInitialHeadlessCheck) {
      options.log?.('Opening profile in headless mode', { profileId })
      headless = await openConnectedPage(options, profileId, 'headless')

      try {
        const initialResult: HHAuthResult = await validateAuth(headless.page, {
          log: options.log,
          timeoutMs: options.timeoutMs
        })
        initialHeadless = initialResult

        if (initialResult.state === 'logged_out') {
          await takeScreenshot(headless.page, options.artifactDir, '01-auth-logged-out.png')
        }

        if (initialResult.state === 'logged_in') {
          await takeScreenshot(headless.page, options.artifactDir, '04-auth-logged-in.png')
          keepHeadlessRunning = Boolean(options.keepProfileRunningOnSuccess)
          return {
            ok: true,
            state: 'logged_in',
            initialHeadless: initialResult,
            finalHeadless: initialResult,
            runningProfile: keepHeadlessRunning ? headless.startedProfile : undefined,
            usedHeadfullLogin: false
          }
        }

        if (initialResult.state === 'captcha') {
          throw new HHAuthError('captcha_detected', 'HH captcha detected during initial headless validation', initialResult)
        }

        if (
          initialResult.state === 'logged_out' &&
          options.loginInHeadlessOnBackUrl &&
          hasLoginBackUrl(initialResult)
        ) {
          options.log?.('HH login backUrl detected in headless mode; logging in on same page', {
            url: initialResult.url
          })
          const credentials = await resolveCredentials(options)
          const headlessLoginResult = await performLoginOnPage(
            headless.page,
            credentials,
            options
          )
          assertLoggedIn(headlessLoginResult, 'login_failed')
          await takeScreenshot(headless.page, options.artifactDir, '04-auth-logged-in.png')
          keepHeadlessRunning = Boolean(options.keepProfileRunningOnSuccess)

          return {
            ok: true,
            state: 'logged_in',
            initialHeadless: initialResult,
            headfullAfterLogin: undefined,
            finalHeadless: headlessLoginResult,
            runningProfile: keepHeadlessRunning ? headless.startedProfile : undefined,
            usedHeadfullLogin: false
          }
        }
      } catch (error: unknown) {
        await takeAuthErrorScreenshot(headless.page, options, 'initial-headless', error)
        throw error
      } finally {
        if (keepHeadlessRunning) {
          await disconnectBrowser(headless.browser)
        } else {
          await releaseStartedProfile(options, profileId, headless.browser)
        }
      }
    }

    const credentials = await resolveCredentials(options)
    options.log?.('Opening profile in headfull mode for login', { profileId })
    const headfull = await openConnectedPage(options, profileId, 'headfull')

    try {
      await gotoHhHome(headfull.page, options)
      const preLoginHeadfullResult: HHAuthResult = await validateAuth(headfull.page, {
        log: options.log,
        timeoutMs: options.timeoutMs
      })

      if (preLoginHeadfullResult.state === 'logged_in') {
        headfullAfterLogin = preLoginHeadfullResult

        if (options.verifyPersistedSession === false) {
          keepHeadfullRunning = Boolean(options.keepProfileRunningOnSuccess)
          return {
            ok: true,
            state: 'logged_in',
            initialHeadless,
            headfullAfterLogin,
            finalHeadless: preLoginHeadfullResult,
            runningProfile: keepHeadfullRunning
              ? headfull.startedProfile
              : undefined,
            usedHeadfullLogin: true
          }
        }
      } else if (preLoginHeadfullResult.state === 'captcha') {
        throw new HHAuthError(
          'captcha_detected',
          'HH captcha detected before headfull login',
          preLoginHeadfullResult
        )
      }

      if (!headfullAfterLogin) {
        const headfullResult: HHAuthResult = await performLoginOnPage(
          headfull.page,
          credentials,
          options
        )
        headfullAfterLogin = headfullResult
        assertLoggedIn(headfullResult, 'login_failed')

        if (options.verifyPersistedSession === false) {
          keepHeadfullRunning = Boolean(options.keepProfileRunningOnSuccess)
          return {
            ok: true,
            state: 'logged_in',
            initialHeadless,
            headfullAfterLogin,
            finalHeadless: headfullResult,
            runningProfile: keepHeadfullRunning
              ? headfull.startedProfile
              : undefined,
            usedHeadfullLogin: true
          }
        }
      }
    } catch (error: unknown) {
      await takeAuthErrorScreenshot(headfull.page, options, 'headfull-login', error)
      throw error
    } finally {
      if (keepHeadfullRunning) {
        await disconnectBrowser(headfull.browser)
      } else {
        await releaseStartedProfile(options, profileId, headfull.browser, 5000)
      }
    }

    options.log?.('Reopening profile in headless mode to verify persisted session', { profileId })
    headless = await openConnectedPage(options, profileId, 'headless')

    try {
      const finalResult: HHAuthResult = await validateAuth(headless.page, {
        log: options.log,
        timeoutMs: options.timeoutMs
      })
      finalHeadless = finalResult
      assertLoggedIn(finalResult, 'session_not_persisted')
      await takeScreenshot(headless.page, options.artifactDir, '04-auth-logged-in.png')
      keepFinalHeadlessRunning = Boolean(options.keepProfileRunningOnSuccess)

      return {
        ok: true,
        state: 'logged_in',
        initialHeadless,
        headfullAfterLogin,
        finalHeadless,
        runningProfile: keepFinalHeadlessRunning
          ? headless.startedProfile
          : undefined,
        usedHeadfullLogin: true
      }
    } catch (error: unknown) {
      await takeAuthErrorScreenshot(headless.page, options, 'final-headless', error)
      throw error
    } finally {
      if (keepFinalHeadlessRunning) {
        await disconnectBrowser(headless.browser)
      } else {
        await releaseStartedProfile(options, profileId, headless.browser)
      }
    }
  }

  return {
    ensureAuthorized
  }
}

module.exports = {
  authorizeHHPage,
  HHAuthError,
  makeHHAuth,
  takeScreenshot,
  waitForAuthAfterSubmit
}
