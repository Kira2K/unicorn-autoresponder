const { isAutoResponderUrl } = require('../shared/hh-url.ts')
const {
  AUTO_RESPONDER_WATCH_MS,
  HH_AUTO_RESPONDER_RUNNING_KEY,
  HH_AUTO_RESPONDER_SETTINGS_KEY,
  HH_AUTO_RESPONDER_STOP_REASON_KEY
} = require('../orchestrator/config.ts')
const {
  isExecutionContextDestroyedError,
  waitForDomContentLoaded
} = require('../browser/page-utils.ts')
const { wait } = require('../orchestrator/runtime-utils.ts')

type BrowserPageLike = import('../orchestrator/types.ts').BrowserPageLike

async function isAutoResponderRunning(
  page: BrowserPageLike
): Promise<boolean | undefined> {
  if (page.isClosed()) {
    return false
  }

  if (!isAutoResponderUrl(page.url())) {
    return undefined
  }

  try {
    return await page.evaluate(
      (runningKey: string) => sessionStorage.getItem(runningKey) === '1',
      HH_AUTO_RESPONDER_RUNNING_KEY
    )
  } catch {
    return undefined
  }
}

type AutoResponderSettingsPatch = {
  coverText?: string
  blockedCompanies?: Array<{ id: string; name: string }>
  limit?: number
}

async function applyAutoResponderSettings(
  page: BrowserPageLike,
  settingsPatch: AutoResponderSettingsPatch
): Promise<void> {
  if (
    !settingsPatch ||
    page.isClosed() ||
    !isAutoResponderUrl(page.url())
  ) {
    return
  }

  await page.evaluate(
    ({
      settingsKey,
      patch
    }: {
      settingsKey: string
      patch: AutoResponderSettingsPatch
    }) => {
      let settings: Record<string, unknown> = {}

      try {
        settings = JSON.parse(localStorage.getItem(settingsKey) || '{}')
      } catch {
        settings = {}
      }

      if (patch.coverText !== undefined) {
        settings.coverText = patch.coverText
        settings.useCover = Boolean(patch.coverText.trim())
      }

      if (Array.isArray(patch.blockedCompanies)) {
        settings.blockedCompanies = patch.blockedCompanies
          .filter(company => company && company.id && company.name)
          .map(company => ({
            id: String(company.id),
            name: String(company.name)
          }))
      }

      if (typeof patch.limit === 'number' && Number.isFinite(patch.limit)) {
        settings.limit = Math.max(1, Math.min(500, Math.round(patch.limit)))
      }

      localStorage.setItem(settingsKey, JSON.stringify(settings))
    },
    {
      settingsKey: HH_AUTO_RESPONDER_SETTINGS_KEY,
      patch: settingsPatch
    }
  )
}

async function applyAutoResponderCoverText(
  page: BrowserPageLike,
  coverText: string | undefined
): Promise<void> {
  if (coverText === undefined) {
    return
  }

  await applyAutoResponderSettings(page, { coverText })
}

async function waitForAutoResponderToFinish(
  page: BrowserPageLike,
  timeoutMs = AUTO_RESPONDER_WATCH_MS,
  isBrowserDisconnected: () => boolean = () => false
): Promise<{
  finished: boolean
  timedOut: boolean
  pageClosed: boolean
  browserDisconnected: boolean
}> {
  const startedAt = Date.now()
  let sawRunning = false
  let idleSince: number | undefined

  while (
    !page.isClosed() &&
    !isBrowserDisconnected() &&
    Date.now() - startedAt < timeoutMs
  ) {
    const running = await isAutoResponderRunning(page)

    if (running === true) {
      sawRunning = true
      idleSince = undefined
    } else if (sawRunning && running === false) {
      idleSince ??= Date.now()

      if (Date.now() - idleSince >= 3000) {
        return {
          finished: true,
          timedOut: false,
          pageClosed: false,
          browserDisconnected: false
        }
      }
    }

    await wait(1000)
  }

  return {
    finished: false,
    timedOut: !page.isClosed() && !isBrowserDisconnected(),
    pageClosed: page.isClosed(),
    browserDisconnected: isBrowserDisconnected()
  }
}

async function stopAutoResponder(page: BrowserPageLike): Promise<boolean> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return false
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await waitForDomContentLoaded(page)

      const clicked = await page.evaluate((stopReasonKey: string) => {
        if (!sessionStorage.getItem(stopReasonKey)) {
          sessionStorage.setItem(
            stopReasonKey,
            JSON.stringify({
              reason: 'orchestrator_stop_after_watch',
              details: 'Orchestrator clicked STOP after watch phase',
              ts: Date.now(),
              url: location.href
            })
          )
        }

        const stopButton = document.getElementById(
          'ar-stop-btn'
        ) as HTMLButtonElement | null

        if (!stopButton) {
          return false
        }

        stopButton.click()
        const renderManualList = (window as any)._hh_ar_renderManualList

        if (typeof renderManualList === 'function') {
          renderManualList()
        }

        return true
      }, HH_AUTO_RESPONDER_STOP_REASON_KEY)

      if (clicked) {
        return true
      }
    } catch (error: any) {
      if (!isExecutionContextDestroyedError(error)) {
        throw error
      }
    }

    await wait(500)
  }

  return false
}

module.exports = {
  applyAutoResponderCoverText,
  applyAutoResponderSettings,
  isAutoResponderRunning,
  stopAutoResponder,
  waitForAutoResponderToFinish
}
