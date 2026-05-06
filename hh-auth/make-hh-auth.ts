import type { HHAuthResult, HHAuthStepResult, HHCredentials, MakeHHAuthOptions, StartedProfile } from './types.js'

const { hhAuthSelectors } = require('./auth-selectors.ts')
const { validateAuth } = require('./validate-auth.ts')
const {
  closeBrowser,
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
  options: MakeHHAuthOptions
): Promise<any> {
  const locator = page.locator(selector).first()

  try {
    await locator.waitFor({
      state: 'attached',
      timeout: options.timeoutMs
    })

    return locator
  } catch (error: unknown) {
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
  options: MakeHHAuthOptions
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

function assertLoggedIn(result: HHAuthResult, code: string): void {
  if (result.state === 'captcha') {
    throw new HHAuthError('captcha_detected', 'HH captcha detected during auth flow', result)
  }

  if (result.state !== 'logged_in') {
    throw new HHAuthError(code, `HH auth validation failed: ${result.state}`, result)
  }
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function takeAuthErrorScreenshot(
  page: any,
  options: MakeHHAuthOptions,
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

function makeHHAuth(options: MakeHHAuthOptions) {
  async function ensureAuthorized(profileId: number): Promise<HHAuthStepResult> {
    let initialHeadless: HHAuthResult | undefined
    let headfullAfterLogin: HHAuthResult | undefined
    let finalHeadless: HHAuthResult | undefined

    options.log?.('Opening profile in headless mode', { profileId })
    let headless = await openConnectedPage(options, profileId, 'headless')

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
        return {
          ok: true,
          state: 'logged_in',
          initialHeadless: initialResult,
          finalHeadless: initialResult
        }
      }

      if (initialResult.state === 'captcha') {
        throw new HHAuthError('captcha_detected', 'HH captcha detected during initial headless validation', initialResult)
      }
    } catch (error: unknown) {
      await takeAuthErrorScreenshot(headless.page, options, 'initial-headless', error)
      throw error
    } finally {
      await closeBrowser(headless.browser)
      await options.stopProfile(profileId).catch(() => undefined)
    }

    const credentials = await resolveCredentials(options)
    options.log?.('Opening profile in headfull mode for login', { profileId })
    const headfull = await openConnectedPage(options, profileId, 'headfull')

    try {
      await headfull.page.goto('https://hh.ru/', {
        waitUntil: 'domcontentloaded',
        timeout: options.timeoutMs
      })

      if (!await selectorExists(headfull.page, hhAuthSelectors.loginForm.phone)) {
        if (await selectorExists(headfull.page, hhAuthSelectors.loginForm.loginButton)) {
          const loginButton = await waitForAuthSelector(
            headfull.page,
            hhAuthSelectors.loginForm.loginButton,
            'login-button',
            options
          )
          await loginButton.click({ timeout: options.timeoutMs })
        }
      }

      if (!await selectorExists(headfull.page, hhAuthSelectors.loginForm.phone)) {
        if (await selectorExists(headfull.page, hhAuthSelectors.loginForm.accountTypeCards)) {
          const accountTypeSubmit = await waitForAuthSelector(
            headfull.page,
            hhAuthSelectors.loginForm.submit,
            'account-type-submit-button',
            options
          )
          await accountTypeSubmit.click({ timeout: options.timeoutMs })
          await headfull.page.waitForLoadState('domcontentloaded', {
            timeout: options.timeoutMs
          }).catch(() => undefined)
          await headfull.page.waitForTimeout(1000)
        }
      }

      await fillAuthField(
        headfull.page,
        hhAuthSelectors.loginForm.phone,
        'phone-input',
        credentials.phone,
        options
      )
      await takeScreenshot(headfull.page, options.artifactDir, '02-auth-phone-entered.png')
      await headfull.page.keyboard.press('Escape').catch(() => undefined)
      await headfull.page.waitForTimeout(500)

      const switchToPassword = await waitForAuthSelector(
        headfull.page,
        hhAuthSelectors.loginForm.switchToPassword,
        'switch-to-password',
        options
      )
      await switchToPassword.click({ timeout: options.timeoutMs })

      await fillAuthField(
        headfull.page,
        hhAuthSelectors.loginForm.password,
        'password-input',
        credentials.password,
        options
      )
      await takeScreenshot(headfull.page, options.artifactDir, '03-auth-password-entered.png')

      const submitButton = await waitForAuthSelector(
        headfull.page,
        hhAuthSelectors.loginForm.submit,
        'submit-button',
        options
      )
      await submitButton.click({ timeout: options.timeoutMs })
      await headfull.page.waitForLoadState('domcontentloaded', {
        timeout: options.timeoutMs
      }).catch(() => undefined)
      await headfull.page.waitForTimeout(3000)

      const headfullResult: HHAuthResult = await validateAuth(headfull.page, {
        log: options.log,
        timeoutMs: options.timeoutMs
      })
      headfullAfterLogin = headfullResult
      assertLoggedIn(headfullResult, 'login_failed')
    } catch (error: unknown) {
      await takeAuthErrorScreenshot(headfull.page, options, 'headfull-login', error)
      throw error
    } finally {
      await closeBrowser(headfull.browser)
      await options.stopProfile(profileId).catch(() => undefined)
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

      return {
        ok: true,
        state: 'logged_in',
        initialHeadless,
        headfullAfterLogin,
        finalHeadless
      }
    } catch (error: unknown) {
      await takeAuthErrorScreenshot(headless.page, options, 'final-headless', error)
      throw error
    } finally {
      await closeBrowser(headless.browser)
      await options.stopProfile(profileId).catch(() => undefined)
    }
  }

  return {
    ensureAuthorized
  }
}

module.exports = {
  HHAuthError,
  makeHHAuth,
  takeScreenshot
}
