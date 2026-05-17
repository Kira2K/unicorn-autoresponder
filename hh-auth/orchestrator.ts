const path = require('node:path')

const { createAppDb } = require('../db/index.ts') as {
  createAppDb(): {
    getHHAuthCredentialsByClientName(clientName: string, market?: 'Ru' | 'En'): Promise<any>
  }
}
const { authorizeHHPage } = require('./index.ts')
const {
  isExecutionContextDestroyedError,
  waitForDomContentLoaded
} = require('../browser/page-utils.ts')
const {
  HH_AUTH_DEBUG,
  HH_AUTH_TIMEOUT_MS,
  HH_AUTH_TOTAL_TIMEOUT_MS,
  HH_INITIAL_NAVIGATION_TIMEOUT_MS,
  HH_SCENARIO_AUTH_UNKNOWN_RECHECK_INTERVAL_MS,
  HH_SCENARIO_AUTH_UNKNOWN_RECHECK_MS,
  LOCAL_RUN_ID,
  LOCAL_RUN_LOG_DIR
} = require('../orchestrator/config.ts')
const { wait, withTimeout } = require('../orchestrator/runtime-utils.ts')

type ClientAutomationData =
  import('../orchestrator/types.ts').ClientAutomationData
type HhAuthCheck = import('../orchestrator/types.ts').HhAuthCheck
type HhAuthState = import('../orchestrator/types.ts').HhAuthState

async function detectHhAuthState(page: any): Promise<HhAuthCheck> {
  const fallback = {
    checkedAt: new Date().toISOString(),
    url: page.isClosed() ? 'closed-page' : page.url(),
    title: '',
    signals: {}
  }

  if (page.isClosed()) {
    return {
      ...fallback,
      state: 'unknown'
    }
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await waitForDomContentLoaded(page)

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
        const signals = {
          login: readSignal('[data-qa="login"]'),
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
          ddosGuard: {
            exists:
              /^ddos-guard$/i.test(document.title.trim()) ||
              /\bddos-guard\b/i.test(document.body?.innerText ?? '')
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
        const loggedOut =
          signals.login.exists ||
          signals.signup.exists ||
          signals.anonymousProfileLink.exists ||
          signals.loginUrl.exists
        const loggedIn =
          signals.profileAndResumesButton.exists ||
          signals.vacancyResponsesButton.exists ||
          signals.mainmenuProfileAndResumes.exists ||
          signals.mainmenuVacancyResponses.exists
        const state =
          loggedIn && !loggedOut
            ? 'logged_in'
            : loggedOut && !loggedIn
              ? 'logged_out'
              : loggedIn && loggedOut
                ? 'conflict'
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
      if (!isExecutionContextDestroyedError(error)) {
        throw error
      }
    }

    await wait(500)
  }

  return {
    ...fallback,
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
  page: any,
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

  while (Date.now() - startedAt < HH_SCENARIO_AUTH_UNKNOWN_RECHECK_MS) {
    if (
      hasDdosGuardSignal(latestCheck) &&
      Date.now() - lastDdosReloadAt >= 15000
    ) {
      lastDdosReloadAt = Date.now()
      await page
        .reload({
          waitUntil: 'domcontentloaded',
          timeout: HH_INITIAL_NAVIGATION_TIMEOUT_MS
        })
        .catch(() => undefined)
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
  page: any
): Promise<HhAuthCheck> {
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
