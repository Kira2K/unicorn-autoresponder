const path = require('node:path')

const { createAppDb } = require('../../../platform/db/index.ts') as {
  createAppDb(): {
    getHHAuthCredentialsByClientName(clientName: string, market?: 'Ru' | 'En'): Promise<any>
  }
}
const { authorizeHHPage } = require('./index.ts')
const {
  isExecutionContextDestroyedError,
  isPageClosedError,
  waitForDomContentLoaded
} = require('../../../platform/browser/page-utils.ts')
const {
  HH_AUTH_DEBUG,
  HH_AUTH_TIMEOUT_MS,
  HH_AUTH_TOTAL_TIMEOUT_MS,
  HH_INITIAL_NAVIGATION_TIMEOUT_MS,
  HH_SCENARIO_AUTH_MAX_RECHECKS,
  HH_SCENARIO_AUTH_UNKNOWN_RECHECK_INTERVAL_MS,
  HH_SCENARIO_AUTH_UNKNOWN_RECHECK_MS,
  LOCAL_RUN_ID,
  LOCAL_RUN_LOG_DIR
} = require('../orchestrator/config.ts')
const { wait, withTimeout } = require('../orchestrator/runtime-utils.ts')

type ClientAutomationData =
  import('../orchestrator/types.ts').ClientAutomationData
type BrowserPageLike = import('../orchestrator/types.ts').BrowserPageLike
type HhAuthCheck = import('../orchestrator/types.ts').HhAuthCheck
type HhAuthState = import('../orchestrator/types.ts').HhAuthState

function makeFallbackHhAuthCheck(
  page: BrowserPageLike,
  state: HhAuthState = 'unknown'
): HhAuthCheck {
  const pageClosed = page.isClosed()

  return {
    checkedAt: new Date().toISOString(),
    url: pageClosed ? 'closed-page' : page.url(),
    title: '',
    state,
    signals: {}
  }
}

async function detectHhAuthState(page: BrowserPageLike): Promise<HhAuthCheck> {
  if (page.isClosed()) {
    return makeFallbackHhAuthCheck(page)
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await waitForDomContentLoaded(page)

      const quickCheck = await page.evaluate(() => {
        const readSignal = (selector: string) => {
          const element = document.querySelector(selector)

          if (!element) {
            return { exists: false }
          }

          return {
            exists: true,
            tag: element.tagName,
            dataQa: element.getAttribute('data-qa'),
            href: element.getAttribute('href'),
            text: (element.textContent || '').trim().slice(0, 120)
          }
        }
        const readAnySignal = (selectors: string[]) => {
          for (const selector of selectors) {
            const signal = readSignal(selector)

            if (signal.exists) {
              return {
                ...signal,
                selector
              }
            }
          }

          return { exists: false }
        }
        const signals = {
          login: readAnySignal([
            '[data-qa="login"]',
            '[data-qa="mainmenu_login"]',
            '[href*="/account/login"]'
          ]),
          signup: readSignal('[data-qa="signup"]'),
          anonymousProfileLink: readSignal(
            '[data-qa="mainmenu_profile-link"][href*="/account/login"]'
          ),
          profileAndResumesButton: readSignal(
            '[data-qa="profileAndResumes-button"]'
          ),
          vacancyResponsesButton: readSignal(
            '[data-qa="vacancyResponses-button"]'
          ),
          mainmenuProfileAndResumes: readSignal(
            '[data-qa="mainmenu_profileAndResumes"]'
          ),
          mainmenuVacancyResponses: readSignal(
            '[data-qa="mainmenu_vacancyResponses"]'
          ),
          applicantResumesLink: readSignal('[href*="/applicant/resumes"]'),
          applicantNegotiationsLink: readSignal(
            '[href*="/applicant/negotiations"]'
          ),
          loginUrl: {
            exists: /^https:\/\/([^/]+\.)?hh\.ru\/account\/login/i.test(location.href)
          },
          loginUrlHasBackUrl: {
            exists:
              /^https:\/\/([^/]+\.)?hh\.ru\/account\/login/i.test(location.href) &&
              /[?&]backUrl=/i.test(location.href)
          }
        }
        const strongLoggedOut =
          signals.login.exists ||
          signals.signup.exists ||
          signals.anonymousProfileLink.exists ||
          signals.loginUrl.exists
        const loggedIn =
          signals.profileAndResumesButton.exists ||
          signals.vacancyResponsesButton.exists ||
          signals.mainmenuProfileAndResumes.exists ||
          signals.mainmenuVacancyResponses.exists ||
          signals.applicantResumesLink.exists ||
          signals.applicantNegotiationsLink.exists
        const state =
          loggedIn && !signals.loginUrl.exists
            ? 'logged_in'
            : strongLoggedOut
              ? 'logged_out'
              : 'unknown'

        return {
          state,
          checkedAt: new Date().toISOString(),
          url: location.href,
          title: document.title,
          signals,
          quickAuthProbe: true
        }
      }) as HhAuthCheck & { quickAuthProbe?: boolean }

      if (!quickCheck.quickAuthProbe || quickCheck.state !== 'unknown') {
        const { quickAuthProbe: _quickAuthProbe, ...authCheck } = quickCheck

        return authCheck
      }

      return await page.evaluate(() => {
        const readSignal = (selector: string) => {
          const element = document.querySelector(selector)

          if (!element) {
            return { exists: false }
          }

          return {
            exists: true,
            tag: element.tagName,
            dataQa: element.getAttribute('data-qa'),
            href: element.getAttribute('href'),
            text: (element.textContent || '').trim().slice(0, 120)
          }
        }
        const readAnySignal = (selectors: string[]) => {
          for (const selector of selectors) {
            const signal = readSignal(selector)

            if (signal.exists) {
              return {
                ...signal,
                selector
              }
            }
          }

          return { exists: false }
        }
        const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim()
        const bodyText = normalizeText(document.body?.innerText || '')
        const hasBodyText = (patterns: RegExp[]) =>
          patterns.some(pattern => pattern.test(bodyText))
        const signals = {
          login: readAnySignal([
            '[data-qa="login"]',
            '[data-qa="mainmenu_login"]',
            '[href*="/account/login"]'
          ]),
          signup: readSignal('[data-qa="signup"]'),
          anonymousProfileLink: readSignal(
            '[data-qa="mainmenu_profile-link"][href*="/account/login"]'
          ),
          profileAndResumesButton: readSignal(
            '[data-qa="profileAndResumes-button"]'
          ),
          vacancyResponsesButton: readSignal(
            '[data-qa="vacancyResponses-button"]'
          ),
          mainmenuProfileAndResumes: readSignal(
            '[data-qa="mainmenu_profileAndResumes"]'
          ),
          mainmenuVacancyResponses: readSignal(
            '[data-qa="mainmenu_vacancyResponses"]'
          ),
          applicantResumesLink: readSignal('[href*="/applicant/resumes"]'),
          applicantNegotiationsLink: readSignal(
            '[href*="/applicant/negotiations"]'
          ),
          loggedInText: {
            exists: hasBodyText([
              /Резюме и профиль/i,
              /Мои резюме/i,
              /Отклики/i,
              /Responses/i,
              /My resumes/i
            ])
          },
          loggedInEscapedText: {
            exists: hasBodyText([
              /\u0420\u0435\u0437\u044e\u043c\u0435 \u0438 \u043f\u0440\u043e\u0444\u0438\u043b\u044c/i,
              /\u041c\u043e\u0438 \u0440\u0435\u0437\u044e\u043c\u0435/i,
              /\u041e\u0442\u043a\u043b\u0438\u043a\u0438/i
            ])
          },
          loggedOutText: {
            exists: hasBodyText([
              /Войти/i,
              /Зарегистрироваться/i,
              /Login/i,
              /Sign up/i
            ])
          },
          loggedOutEscapedText: {
            exists: hasBodyText([
              /\u0412\u043e\u0439\u0442\u0438/i,
              /\u0417\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c\u0441\u044f/i
            ])
          },
          ddosGuard: {
            exists:
              /^ddos-guard$/i.test(document.title.trim()) ||
              /\bddos-guard\b/i.test(document.body?.innerText ?? '')
          },
          hhCaptchaChallenge: {
            exists: (() => {
              const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
              const bodyText = normalize(document.body?.innerText || '')

              return (
                /пройдите капчу|текст с картинки|captcha|капч/i.test(bodyText) ||
                /\u043f\u0440\u043e\u0439\u0434\u0438\u0442\u0435 \u043a\u0430\u043f\u0447\u0443|\u0442\u0435\u043a\u0441\u0442 \u0441 \u043a\u0430\u0440\u0442\u0438\u043d\u043a\u0438|captcha|\u043a\u0430\u043f\u0447/i.test(bodyText) ||
                Array.from(document.querySelectorAll('input')).some(input => {
                  const placeholder = input.getAttribute('placeholder') || ''
                  const ariaLabel = input.getAttribute('aria-label') || ''

                  return /текст с картинки|captcha|капч/i.test(
                    `${placeholder} ${ariaLabel}`
                  )
                })
              )
            })()
          },
          loginUrl: {
            exists: /^https:\/\/([^/]+\.)?hh\.ru\/account\/login/i.test(location.href)
          },
          loginUrlHasBackUrl: {
            exists:
              /^https:\/\/([^/]+\.)?hh\.ru\/account\/login/i.test(location.href) &&
              /[?&]backUrl=/i.test(location.href)
          }
        }
        const strongLoggedOut =
          signals.login.exists ||
          signals.signup.exists ||
          signals.anonymousProfileLink.exists ||
          signals.loginUrl.exists
        const weakLoggedOut =
          signals.loggedOutText.exists ||
          signals.loggedOutEscapedText.exists
        const loggedIn =
          signals.profileAndResumesButton.exists ||
          signals.vacancyResponsesButton.exists ||
          signals.mainmenuProfileAndResumes.exists ||
          signals.mainmenuVacancyResponses.exists ||
          signals.applicantResumesLink.exists ||
          signals.applicantNegotiationsLink.exists ||
          signals.loggedInText.exists ||
          signals.loggedInEscapedText.exists
        const captchaDetected = signals.hhCaptchaChallenge.exists
        const state =
          captchaDetected
            ? 'captcha'
            : loggedIn && !signals.loginUrl.exists
            ? 'logged_in'
            : strongLoggedOut || weakLoggedOut
              ? 'logged_out'
              : 'unknown'

        return {
          state,
          checkedAt: new Date().toISOString(),
          url: location.href,
          title: document.title,
          signals
        }
      })
    } catch (error: any) {
      if (page.isClosed() || isPageClosedError(error)) {
        return makeFallbackHhAuthCheck(page)
      }

      if (!isExecutionContextDestroyedError(error)) {
        throw error
      }
    }

    await wait(500)
  }

  return {
    ...makeFallbackHhAuthCheck(page),
    state: 'unknown'
  }
}

function isIndecisiveHhAuthState(state: HhAuthState): boolean {
  return state === 'unknown' || state === 'conflict'
}

function hasDdosGuardSignal(check: HhAuthCheck): boolean {
  return Boolean(check.signals.ddosGuard?.exists)
}

function shouldRunHHAuthFallback(state: HhAuthState): boolean {
  return state === 'logged_out' || state === 'captcha'
}

async function waitForScenarioAuthDecision(
  page: BrowserPageLike,
  initialCheck: HhAuthCheck
): Promise<{ check: HhAuthCheck; recheckCount: number }> {
  if (!isIndecisiveHhAuthState(initialCheck.state)) {
    return {
      check: initialCheck,
      recheckCount: 0
    }
  }

  const startedAt = Date.now()
  let latestCheck = initialCheck
  let recheckCount = 0
  let lastDdosReloadAt = 0

  while (
    Date.now() - startedAt < HH_SCENARIO_AUTH_UNKNOWN_RECHECK_MS &&
    recheckCount < HH_SCENARIO_AUTH_MAX_RECHECKS
  ) {
    if (
      hasDdosGuardSignal(latestCheck) &&
      Date.now() - lastDdosReloadAt >= 15000
    ) {
      lastDdosReloadAt = Date.now()
      await (page.reload
        ? page.reload({
          waitUntil: 'domcontentloaded',
          timeout: HH_INITIAL_NAVIGATION_TIMEOUT_MS
        })
        : Promise.resolve(undefined)
      ).catch(() => undefined)
    }

    await wait(HH_SCENARIO_AUTH_UNKNOWN_RECHECK_INTERVAL_MS)
    latestCheck = await detectHhAuthState(page)
    recheckCount += 1

    if (!isIndecisiveHhAuthState(latestCheck.state)) {
      return {
        check: latestCheck,
        recheckCount
      }
    }
  }

  return {
    check: latestCheck,
    recheckCount
  }
}

function convertHHAuthResultToCheck(result: any): HhAuthCheck {
  const signals = Object.fromEntries(
    Object.entries(result?.signals ?? {}).map(([name, exists]) => [
      name,
      {
        exists: Boolean(exists)
      }
    ])
  )

  return {
    state: result?.state ?? 'unknown',
    checkedAt: result?.checkedAt ?? new Date().toISOString(),
    url: result?.url ?? '',
    title: result?.title ?? '',
    signals
  }
}

function getHHAuthArtifactDir(
  clientData: ClientAutomationData
): string | undefined {
  if (!HH_AUTH_DEBUG) {
    return undefined
  }

  return getHHAuthLogDir(clientData, 'hh-auth-orchestrator')
}

function getHHAuthErrorArtifactDir(clientData: ClientAutomationData): string {
  return getHHAuthLogDir(clientData, 'hh-auth-errors')
}

function getHHAuthLogDir(
  clientData: ClientAutomationData,
  prefix: string
): string {
  const safeName = clientData.clientName.replace(/[\\/:*?"<>|\s]+/g, '_')
  const safeMarket = clientData.market ?? 'default'

  return path.join(
    LOCAL_RUN_LOG_DIR,
    `${prefix}-${LOCAL_RUN_ID}-${safeName}-${safeMarket}`
  )
}

async function ensureHHAuthOnCurrentPage(
  clientData: ClientAutomationData,
  page: BrowserPageLike
): Promise<HhAuthCheck> {
  if (page.isClosed()) {
    throw new Error(
      `HH auth cannot run because the page is already closed for ` +
        `${clientData.clientName}/${clientData.market}`
    )
  }

  const result = await withTimeout(
    authorizeHHPage(page, {
      artifactDir: getHHAuthArtifactDir(clientData),
      errorArtifactDir: getHHAuthErrorArtifactDir(clientData),
      getCredentials: async () => {
        const credentials =
          clientData.hhAuthCredentials ??
          (await createAppDb().getHHAuthCredentialsByClientName(
            clientData.clientName,
            clientData.market
          ))

        return {
          email: credentials.email,
          password: credentials.password
        }
      },
      log: (message: string, details?: Record<string, unknown>) => {
        console.log(
          `[hh auth] ${clientData.clientName}: ${message}`,
          details ?? {}
        )
      },
      timeoutMs: HH_AUTH_TIMEOUT_MS
    }),
    HH_AUTH_TOTAL_TIMEOUT_MS,
    `HH auth timed out after ${HH_AUTH_TOTAL_TIMEOUT_MS}ms for ` +
      `${clientData.clientName}/${clientData.market} on the current page`
  )

  return convertHHAuthResultToCheck(result)
}

function formatAuthCheckBrief(check: HhAuthCheck): string {
  const signalNames = Object.entries(check.signals)
    .filter(([, signal]) => signal.exists)
    .map(([name]) => name)

  return `${check.state}; signals ${signalNames.join(', ') || 'none'}; url ${check.url}`
}

module.exports = {
  detectHhAuthState,
  ensureHHAuthOnCurrentPage,
  formatAuthCheckBrief,
  isIndecisiveHhAuthState,
  shouldRunHHAuthFallback,
  waitForScenarioAuthDecision
}
