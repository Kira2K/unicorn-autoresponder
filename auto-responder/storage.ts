const { isAutoResponderUrl } = require('../shared/hh-url.ts')
const {
  HH_AUTO_RESPONDER_MANUAL_LIST_KEY,
  HH_AUTO_RESPONDER_RECENT_URLS_KEY,
  HH_AUTO_RESPONDER_STOP_REASON_KEY,
  HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSES_KEY
} = require('../orchestrator/config.ts')
const {
  isExecutionContextDestroyedError,
  waitForDomContentLoaded
} = require('../browser/page-utils.ts')
const { wait } = require('../orchestrator/runtime-utils.ts')

type AutoResponderStopReason =
  import('../orchestrator/types.ts').AutoResponderStopReason
type ManualVacancy = import('../orchestrator/types.ts').ManualVacancy
type RecentUrlEntry = import('../orchestrator/types.ts').RecentUrlEntry

async function getAutoResponderStopReason(
  page: any
): Promise<AutoResponderStopReason | undefined> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return undefined
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await waitForDomContentLoaded(page)

      return await page.evaluate((stopReasonKey: string) => {
        const raw = sessionStorage.getItem(stopReasonKey)

        if (!raw) {
          return undefined
        }

        try {
          const parsed = JSON.parse(raw)

          return parsed && typeof parsed === 'object'
            ? parsed
            : { reason: String(raw) }
        } catch {
          return { reason: String(raw) }
        }
      }, HH_AUTO_RESPONDER_STOP_REASON_KEY)
    } catch (error: any) {
      if (!isExecutionContextDestroyedError(error)) {
        throw error
      }
    }

    await wait(500)
  }

  return undefined
}

async function getAutoResponderRecentUrls(
  page: any
): Promise<RecentUrlEntry[]> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return []
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await waitForDomContentLoaded(page)

      return await page.evaluate((recentUrlsKey: string) => {
        try {
          const parsed = JSON.parse(
            sessionStorage.getItem(recentUrlsKey) || '[]'
          )

          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }, HH_AUTO_RESPONDER_RECENT_URLS_KEY)
    } catch (error: any) {
      if (!isExecutionContextDestroyedError(error)) {
        throw error
      }
    }

    await wait(500)
  }

  return []
}

async function getManualVacancies(page: any): Promise<ManualVacancy[]> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return []
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await waitForDomContentLoaded(page)

      return await page.evaluate((manualListKey: string) => {
        try {
          const raw = localStorage.getItem(manualListKey) || '[]'
          const parsed = JSON.parse(raw)

          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }, HH_AUTO_RESPONDER_MANUAL_LIST_KEY)
    } catch (error: any) {
      if (!isExecutionContextDestroyedError(error)) {
        throw error
      }
    }

    await wait(500)
  }

  return []
}

async function getAutoResponderSuccessCount(page: any): Promise<number> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return 0
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await waitForDomContentLoaded(page)

      return await page.evaluate((successfulResponsesKey: string) => {
        const count = Number(
          sessionStorage.getItem(successfulResponsesKey) || '0'
        )

        return Number.isFinite(count) ? count : 0
      }, HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSES_KEY)
    } catch (error: any) {
      if (!isExecutionContextDestroyedError(error)) {
        throw error
      }
    }

    await wait(500)
  }

  return 0
}

module.exports = {
  getAutoResponderRecentUrls,
  getAutoResponderStopReason,
  getAutoResponderSuccessCount,
  getManualVacancies
}
