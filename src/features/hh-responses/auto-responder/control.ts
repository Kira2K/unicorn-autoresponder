const { isAutoResponderUrl } = require('../shared/hh-url.ts')
const {
  AUTO_RESPONDER_WATCH_MS,
  HH_AUTO_RESPONDER_RECENT_URLS_KEY,
  HH_AUTO_RESPONDER_RUNNING_KEY,
  HH_AUTO_RESPONDER_SETTINGS_KEY,
  HH_AUTO_RESPONDER_STOP_REASON_KEY
} = require('../orchestrator/config.ts')
const {
  isExecutionContextDestroyedError,
  waitForDomContentLoaded
} = require('../../../platform/browser/page-utils.ts')
const { wait } = require('../orchestrator/runtime-utils.ts')

type BrowserPageLike = import('../orchestrator/types.ts').BrowserPageLike
const RESUME_LOOP_STALL_MS = 90 * 1000

type ResumeLoopProbe = {
  latestKey: string
  latestReason: string
  currentUrl: string
}

function normalizeResumeLoopProbe(value: any): ResumeLoopProbe | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const latestKey = String(value.latestKey ?? '').trim()
  const latestReason = String(value.latestReason ?? '').trim()
  const currentUrl = String(value.currentUrl ?? '').trim()

  if (!latestKey || latestReason !== 'resume-loop') {
    return undefined
  }

  return {
    latestKey,
    latestReason,
    currentUrl
  }
}

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

async function getResumeLoopProbe(
  page: BrowserPageLike
): Promise<ResumeLoopProbe | undefined> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return undefined
  }

  try {
    const rawProbe = await page.evaluate((recentUrlsKey: string) => {
      let recentUrls: any[] = []

      try {
        const parsed = JSON.parse(sessionStorage.getItem(recentUrlsKey) || '[]')
        recentUrls = Array.isArray(parsed) ? parsed : []
      } catch {
        recentUrls = []
      }

      const latest = recentUrls[recentUrls.length - 1]
      if (!latest || latest.reason !== 'resume-loop') {
        return undefined
      }

      return {
        currentUrl: location.href,
        latestKey: [
          latest.reason || '',
          latest.url || '',
          latest.title || ''
        ].join('|'),
        latestReason: latest.reason
      }
    }, HH_AUTO_RESPONDER_RECENT_URLS_KEY)

    return normalizeResumeLoopProbe(rawProbe)
  } catch {
    return undefined
  }
}

async function stopAutoResponderForResumeLoop(
  page: BrowserPageLike,
  probe: ResumeLoopProbe
): Promise<boolean> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return false
  }

  try {
    return await page.evaluate(
      ({
        runningKey,
        stopReasonKey,
        details
      }: {
        runningKey: string
        stopReasonKey: string
        details: string
      }) => {
        sessionStorage.setItem(
          stopReasonKey,
          JSON.stringify({
            reason: 'resume_loop_detected',
            details,
            ts: Date.now(),
            url: location.href
          })
        )
        sessionStorage.removeItem(runningKey)

        const stopButton = document.getElementById(
          'ar-stop-btn'
        ) as HTMLButtonElement | null

        if (stopButton) {
          stopButton.click()
        }

        return true
      },
      {
        runningKey: HH_AUTO_RESPONDER_RUNNING_KEY,
        stopReasonKey: HH_AUTO_RESPONDER_STOP_REASON_KEY,
        details:
          `Orchestrator stopped a stale resume-loop after ${RESUME_LOOP_STALL_MS}ms. ` +
          `Current URL: ${probe.currentUrl}`
      }
    )
  } catch {
    return false
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
  let resumeLoopProbeKey: string | undefined
  let resumeLoopSince: number | undefined
  const hasWatchTimeout =
    typeof timeoutMs === 'number' &&
    Number.isFinite(timeoutMs) &&
    timeoutMs > 0

  while (
    !page.isClosed() &&
    !isBrowserDisconnected() &&
    (!hasWatchTimeout || Date.now() - startedAt < timeoutMs)
  ) {
    const running = await isAutoResponderRunning(page)
    const resumeLoopProbe = await getResumeLoopProbe(page)

    if (running === true && resumeLoopProbe) {
      if (resumeLoopProbe.latestKey !== resumeLoopProbeKey) {
        resumeLoopProbeKey = resumeLoopProbe.latestKey
        resumeLoopSince = Date.now()
      } else if (
        resumeLoopSince &&
        Date.now() - resumeLoopSince >= RESUME_LOOP_STALL_MS
      ) {
        await stopAutoResponderForResumeLoop(page, resumeLoopProbe)
        return {
          finished: true,
          timedOut: false,
          pageClosed: false,
          browserDisconnected: false
        }
      }
    } else {
      resumeLoopProbeKey = undefined
      resumeLoopSince = undefined
    }

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
    timedOut: hasWatchTimeout && !page.isClosed() && !isBrowserDisconnected(),
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
