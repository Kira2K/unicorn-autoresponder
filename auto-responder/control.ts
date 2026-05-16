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

async function isAutoResponderRunning(page: any): Promise<boolean | undefined> {
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

async function applyAutoResponderCoverText(
  page: any,
  coverText: string | undefined
): Promise<void> {
  if (
    coverText === undefined ||
    page.isClosed() ||
    !isAutoResponderUrl(page.url())
  ) {
    return
  }

  await page.evaluate(
    ({ settingsKey, cover }: { settingsKey: string; cover: string }) => {
      let settings: Record<string, unknown> = {}

      try {
        settings = JSON.parse(localStorage.getItem(settingsKey) || '{}')
      } catch {
        settings = {}
      }

      settings.coverText = cover
      settings.useCover = Boolean(cover.trim())
      localStorage.setItem(settingsKey, JSON.stringify(settings))
    },
    {
      settingsKey: HH_AUTO_RESPONDER_SETTINGS_KEY,
      cover: coverText
    }
  )
}

async function waitForAutoResponderToFinish(
  page: any,
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

async function stopAutoResponder(page: any): Promise<boolean> {
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
  isAutoResponderRunning,
  stopAutoResponder,
  waitForAutoResponderToFinish
}
