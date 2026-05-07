const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const childProcess = require('node:child_process')
require('dotenv').config({ quiet: true })

const { getClientHHAuthCredentials } = require('./google-sheets-check.ts')
const {
  createClientAutomationRepository
} = require('./sheets/automation-repository.ts')
const { makeHHAuth } = require('./hh-auth/index.ts')
const { sendTelegramMessage } = require('./messenger.ts')
const { runManualVacanciesCleanup } = require('./manual-vacancies-cleanup.ts')
const {
  getVacancyIdFromUrl,
  isAutoResponderUrl
} = require('./shared/hh-url.ts')
const { requestDolphinCloudApi } =
  require('./orchestrator/dolphin-cloud-api.ts') as {
    requestDolphinCloudApi<T>(
      endpointPath: string,
      options?: {
        method?: 'GET' | 'PATCH' | 'POST' | 'DELETE' | 'PUT'
        query?: Record<string, string | number | boolean | undefined>
        body?: unknown
      }
    ): Promise<T>
  }
const { splitTelegramMessage } = require('./orchestrator/reports.ts')
const {
  AUTOMATION_LOCK_STATUS_COLOR,
  AUTOMATION_LOCK_STATUS_NAME,
  AUTOMATION_LOCK_TAG,
  AUTO_RESPONDER_WATCH_MS,
  AUTH_CHECK_PARSER_ERROR_CODES,
  CLIENT_START_DELAY_MS,
  CONNECT_OVER_CDP_TIMEOUT_MS,
  DOLPHIN_HEADLESS,
  DOLPHIN_LOCAL_API_BASE_URL,
  DOLPHIN_LOCAL_API_HEALTH_TIMEOUT_MS,
  DOLPHIN_PROFILE_RELEASE_AFTER_AUTH_WAIT_MS,
  DOLPHIN_PROFILE_START_MAX_ATTEMPTS,
  DOLPHIN_PROFILE_START_RETRY_BASE_MS,
  EXTERNAL_TIMEOUT_MULTIPLIER,
  EXTERNAL_TIMEOUT_PROFILE_BUFFER_MS,
  HH_AUTH_DEBUG,
  HH_AUTH_TIMEOUT_MS,
  HH_AUTO_RESPONDER_LOGS_KEY,
  HH_AUTO_RESPONDER_MANUAL_LIST_KEY,
  HH_AUTO_RESPONDER_PARSER_ERRORS_KEY,
  HH_AUTO_RESPONDER_RECENT_URLS_KEY,
  HH_AUTO_RESPONDER_RUNNING_KEY,
  HH_AUTO_RESPONDER_SETTINGS_KEY,
  HH_AUTO_RESPONDER_STOP_REASON_KEY,
  HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSES_KEY,
  HH_INITIAL_NAVIGATION_TIMEOUT_MS,
  INDEX_SCRIPT_PATH,
  LOCAL_RUN_ID,
  LOCAL_RUN_LOG_DIR,
  LOCAL_RUN_LOG_FILE,
  LOGS_CHANNEL_ID,
  MAX_PREEXISTING_DOLPHIN_PROFILES,
  NORMAL_AUTO_RESPONDER_STOP_REASONS,
  ORCHESTRATOR_WORK_WITH_MARKET,
  SUMMARY_LOGS_CHANNEL_ID,
  TELEGRAM_MESSAGE_LIMIT
} = require('./orchestrator/config.ts')
const startedProfileIds = new Set<number>()
let automationLockStatusId: number | undefined

type ClientAutomationData = {
  clientName: string
  stack: string
  market: 'Ru' | 'En'
  stackSheetName: string
  stackScenario?: string
  dolphinProfileId: number
  commonChatId: string
  coverText?: string
  hhAuthCredentials?: ClientHHAuthCredentials
}

type ClientHHAuthCredentials = {
  clientName: string
  market?: 'Ru' | 'En'
  phone: string
  rawPhone: string
  password: string
  email: string
  emailPassword?: string
}

type AutomationTargetOptions = {
  workWithRuOnly?: boolean
  market?: 'Ru' | 'En'
}

type DolphinStartResponse = {
  success?: boolean
  automation?: {
    port?: number
    wsEndpoint?: string
  }
  error?: string
  errorObject?: {
    code?: string
    text?: string
  }
}

type DolphinBrowserProfile = {
  id: number | string
  tags?: string[]
  status?: DolphinProfileStatus | null
}

type DolphinProfileResponse = {
  data?: DolphinBrowserProfile
}

type DolphinProfileStatus = {
  id?: number | string
  name?: string
  color?: string
  deleted?: number
}

type DolphinProfileStatusResponse = {
  data?: DolphinProfileStatus
}

type DolphinProfileStatusListResponse = {
  data?: DolphinProfileStatus[]
}

type OrchestratorStatus = {
  clientName: string
  stack: string
  market?: string
  dolphinProfileId: number
  commonChatId: string
  stackScenario: string
  lifecycleEvents: LifecycleEvent[]
  opened: boolean
  indexScriptInjected: boolean
  watcherInstalled: boolean
  startButtonClicked: boolean
  stopButtonClicked?: boolean
  autoResponderFinished?: boolean
  autoResponderWatchTimedOut?: boolean
  autoResponderStopReason?: string
  autoResponderStopReasonDetails?: string
  responseCount?: number
  vacancyTransitionCount?: number
  manualVacanciesCount?: number
  parserLogsCount?: number
  parserErrorLogsCount?: number
  parserErrorCodes?: string[]
  parserLastErrorCode?: string
  recentUrls?: RecentUrlEntry[]
  manualVacanciesCleanup?: ManualVacanciesCleanupResult
  authBeforeStart?: HhAuthCheck
  authAfterParserStop?: HhAuthCheck
  parserLogsSent?: boolean
  manualVacanciesSent?: boolean
  profileTagAdded?: boolean
  profileTagRemoved?: boolean
  profileTagVerifiedAfterAdd?: boolean
  profileTagVerifiedAfterRemove?: boolean
  profileStatusApplied?: boolean
  profileStatusRestored?: boolean
  profileStopped?: boolean
  pageTitle?: string
  pageUrl?: string
  telegramError?: string
  errorStack?: string
  error?: string
}

type ManualVacanciesCleanupResult = {
  skipped: boolean
  completed: boolean
  initialCount: number
  checkedCount: number
  removedCount: number
  remainingCount: number
  keptCount: number
  items: Array<{
    id: string
    url: string
    title?: string
    action: 'removed' | 'kept'
    reason: string
  }>
}

type LifecycleEvent = {
  at: string
  elapsedMs: number
  event: string
  details?: string
}

type ManualVacancy = {
  vid?: string
  url?: string
  returnUrl?: string
  ts?: number
  title?: string
}

type ParserLogEntry = {
  ts?: number
  time?: string
  message?: string
  isError?: boolean
  url?: string
}

type AutoResponderStopReason = {
  reason?: string
  details?: string
  ts?: number
  url?: string
  recentUrls?: RecentUrlEntry[]
}

type ParserErrorEntry = {
  code?: string
  details?: string
  ts?: number
  url?: string
  recentUrls?: RecentUrlEntry[]
}

type RecentUrlEntry = {
  url?: string
  title?: string
  reason?: string
  ts?: number
}

type HhAuthState =
  | 'logged_in'
  | 'logged_out'
  | 'captcha'
  | 'unknown'
  | 'conflict'

type HhAuthSignal = {
  exists: boolean
  tag?: string
  dataQa?: string | null
  href?: string | null
  text?: string
}

type HhAuthCheck = {
  state: HhAuthState
  checkedAt: string
  url: string
  title: string
  signals: Record<string, HhAuthSignal>
}

type LocalRunLogRecord = {
  kind: string
  runId?: string
  at?: string
  [key: string]: unknown
}

type ResponseCounter = {
  vacancyIds: Set<string>
}

type OpenScenarioResult = {
  page: any
  disposeWatcher: () => void
  isBrowserDisconnected: () => boolean
  result: {
    opened: boolean
    indexScriptInjected: boolean
    watcherInstalled: boolean
    startButtonClicked: boolean
    pageTitle: string
    pageUrl: string
    manualVacanciesCleanup: ManualVacanciesCleanupResult
    authBeforeStart?: HhAuthCheck
  }
}

function loadPlaywright() {
  try {
    return require('playwright')
  } catch {
    return require('C:/Users/kiras/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
  }
}

function createResponseCounter(): ResponseCounter {
  return {
    vacancyIds: new Set<string>()
  }
}

function recordVacancyTransition(counter: ResponseCounter, url: string): void {
  const vacancyId = getVacancyIdFromUrl(url)

  if (vacancyId) {
    counter.vacancyIds.add(vacancyId)
  }
}

function isWatcherNavigationRaceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)

  return (
    message.includes('Execution context was destroyed') ||
    (message.includes('page.waitForSelector: Timeout') &&
      message.includes('#ar-main-panel')) ||
    (message.includes('page.waitForSelector: Timeout') &&
      message.includes('navigation to finish'))
  )
}

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

async function ensureIndexScript(
  page: any,
  indexScript: string,
  reason: string
): Promise<boolean> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return false
  }

  await page
    .waitForLoadState('domcontentloaded', {
      timeout: 10000
    })
    .catch(() => undefined)

  const injectionState = await page.evaluate((source: string) => {
    if (document.getElementById('ar-main-panel')) {
      return 'already-present'
    }

    ;(0, eval)(source)
    document.documentElement.appendChild(
      document.createComment('hh-autoparcer-index-loaded')
    )

    return 'injected'
  }, indexScript)

  await page.waitForSelector('#ar-main-panel', {
    timeout: 10000
  })

  if (injectionState === 'injected') {
    console.log(`index.js injected after ${reason}: ${page.url()}`)
  }

  return true
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

function installIndexReinjectWatcher(
  page: any,
  indexScript: string,
  responseCounter: ResponseCounter
): () => void {
  let disposed = false
  let queue = Promise.resolve()

  const scheduleInject = (reason: string) => {
    if (disposed || page.isClosed()) {
      return
    }

    recordVacancyTransition(responseCounter, page.url())

    queue = queue
      .then(async () => {
        await ensureIndexScript(page, indexScript, reason)
      })
      .catch((error: unknown) => {
        if (!disposed && !isWatcherNavigationRaceError(error)) {
          console.error(error instanceof Error ? error.message : error)
        }
      })
  }

  const onFrameNavigated = (frame: any) => {
    if (frame === page.mainFrame()) {
      recordVacancyTransition(responseCounter, frame.url())
      scheduleInject('navigation')
    }
  }
  const onDomContentLoaded = () => {
    recordVacancyTransition(responseCounter, page.url())
    scheduleInject('domcontentloaded')
  }

  page.on('framenavigated', onFrameNavigated)
  page.on('domcontentloaded', onDomContentLoaded)

  return () => {
    disposed = true
    page.off('framenavigated', onFrameNavigated)
    page.off('domcontentloaded', onDomContentLoaded)
  }
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
      await page
        .waitForLoadState('domcontentloaded', {
          timeout: 5000
        })
        .catch(() => undefined)

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
      if (
        !String(error?.message ?? '').includes(
          'Execution context was destroyed'
        )
      ) {
        throw error
      }
    }

    await wait(500)
  }

  return false
}

async function getAutoResponderStopReason(
  page: any
): Promise<AutoResponderStopReason | undefined> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return undefined
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await page
        .waitForLoadState('domcontentloaded', {
          timeout: 5000
        })
        .catch(() => undefined)

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
      if (
        !String(error?.message ?? '').includes(
          'Execution context was destroyed'
        )
      ) {
        throw error
      }
    }

    await wait(500)
  }

  return undefined
}

function extractParserErrorCodesFromLogs(
  parserLogs: ParserLogEntry[]
): string[] {
  const codes = new Set<string>()
  const knownCodePattern = /\b(?:ERROR_[A-Z0-9_]+|NO_[A-Z0-9_]+)\b/g

  for (const entry of parserLogs) {
    if (!entry.isError) {
      continue
    }

    const message = String(entry.message ?? '').toUpperCase()
    const matches = message.match(knownCodePattern)

    if (matches?.length) {
      for (const match of matches) {
        codes.add(match)
      }
    }
  }

  return [...codes]
}

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
      await page
        .waitForLoadState('domcontentloaded', {
          timeout: 5000
        })
        .catch(() => undefined)

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
          )
        }
        const loggedOut =
          signals.login.exists ||
          signals.signup.exists ||
          signals.anonymousProfileLink.exists
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
      if (
        !String(error?.message ?? '').includes(
          'Execution context was destroyed'
        )
      ) {
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

function shouldCheckAuthAfterParserStop(status: OrchestratorStatus): boolean {
  if (!status.autoResponderStopReason || isAutoResponderStopNormal(status)) {
    return false
  }

  return (
    status.autoResponderStopReason.includes('error') ||
    AUTH_CHECK_PARSER_ERROR_CODES.has(status.autoResponderStopReason) ||
    Boolean(
      status.autoResponderStopReasonDetails &&
      AUTH_CHECK_PARSER_ERROR_CODES.has(status.autoResponderStopReasonDetails)
    ) ||
    Boolean(
      status.parserErrorCodes?.some(code =>
        AUTH_CHECK_PARSER_ERROR_CODES.has(code)
      )
    )
  )
}

async function getAutoResponderParserErrors(
  page: any
): Promise<ParserErrorEntry[]> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return []
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await page
        .waitForLoadState('domcontentloaded', {
          timeout: 5000
        })
        .catch(() => undefined)

      return await page.evaluate((parserErrorsKey: string) => {
        try {
          const parsed = JSON.parse(
            sessionStorage.getItem(parserErrorsKey) || '[]'
          )

          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }, HH_AUTO_RESPONDER_PARSER_ERRORS_KEY)
    } catch (error: any) {
      if (
        !String(error?.message ?? '').includes(
          'Execution context was destroyed'
        )
      ) {
        throw error
      }
    }

    await wait(500)
  }

  return []
}

async function getAutoResponderRecentUrls(
  page: any
): Promise<RecentUrlEntry[]> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return []
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await page
        .waitForLoadState('domcontentloaded', {
          timeout: 5000
        })
        .catch(() => undefined)

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
      if (
        !String(error?.message ?? '').includes(
          'Execution context was destroyed'
        )
      ) {
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
      await page
        .waitForLoadState('domcontentloaded', {
          timeout: 5000
        })
        .catch(() => undefined)

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
      if (
        !String(error?.message ?? '').includes(
          'Execution context was destroyed'
        )
      ) {
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
      await page
        .waitForLoadState('domcontentloaded', {
          timeout: 5000
        })
        .catch(() => undefined)

      return await page.evaluate((successfulResponsesKey: string) => {
        const count = Number(
          sessionStorage.getItem(successfulResponsesKey) || '0'
        )

        return Number.isFinite(count) ? count : 0
      }, HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSES_KEY)
    } catch (error: any) {
      if (
        !String(error?.message ?? '').includes(
          'Execution context was destroyed'
        )
      ) {
        throw error
      }
    }

    await wait(500)
  }

  return 0
}

async function getParserLogs(page: any): Promise<ParserLogEntry[]> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return []
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await page
        .waitForLoadState('domcontentloaded', {
          timeout: 5000
        })
        .catch(() => undefined)

      return await page.evaluate((logsKey: string) => {
        try {
          const raw = sessionStorage.getItem(logsKey) || '[]'
          const parsed = JSON.parse(raw)

          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }, HH_AUTO_RESPONDER_LOGS_KEY)
    } catch (error: any) {
      if (
        !String(error?.message ?? '').includes(
          'Execution context was destroyed'
        )
      ) {
        throw error
      }
    }

    await wait(500)
  }

  return []
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 20)}\n...truncated`
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function getErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined
}

function stringifyApiMessage(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value === 'string') {
    return value.trim() || undefined
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatStatusFlag(label: string, value: unknown): string {
  return `${label}: ${value === undefined ? 'n/a' : String(value)}`
}

function truncateTelegramLine(value: string, maxLength = 350): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 14)}...truncated`
}

function escapeTelegramHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function getTelegramLinkLabel(parsedUrl: URL): string {
  const vacancyId = getVacancyIdFromUrl(parsedUrl.href)

  if (vacancyId) {
    return `${parsedUrl.hostname}/vacancy/${vacancyId}`
  }

  if (parsedUrl.pathname === '/search/vacancy') {
    return `${parsedUrl.hostname}/search/vacancy`
  }

  return `${parsedUrl.hostname}${parsedUrl.pathname}`
}

function formatTelegramLink(url: string | undefined, label?: string): string {
  if (!url) {
    return escapeTelegramHtml('n/a')
  }

  try {
    const parsedUrl = new URL(url)

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return escapeTelegramHtml(url)
    }

    return `<a href="${escapeTelegramHtml(parsedUrl.href)}">${escapeTelegramHtml(label || getTelegramLinkLabel(parsedUrl))}</a>`
  } catch {
    return escapeTelegramHtml(url)
  }
}

function replaceUrlsWithTelegramLinks(value: string, label?: string): string {
  return escapeTelegramHtml(value).replace(/https?:\/\/[^\s<]+/g, url => {
    const normalizedUrl = url.replace(/&amp;/g, '&')

    return formatTelegramLink(normalizedUrl, label)
  })
}

function formatAuthStatusForTelegram(
  status: OrchestratorStatus
): string | undefined {
  const states = [
    status.authBeforeStart
      ? `before ${status.authBeforeStart.state}`
      : undefined,
    status.authAfterParserStop
      ? `after ${status.authAfterParserStop.state}`
      : undefined
  ].filter(Boolean)

  return states.length ? `Auth status: ${states.join('; ')}` : undefined
}

function formatManualVacanciesCleanupBrief(
  result: ManualVacanciesCleanupResult | undefined
): string | undefined {
  if (!result) {
    return undefined
  }

  if (result.skipped) {
    return 'manual vacancies list empty'
  }

  return [
    `manual vacancies initial ${result.initialCount}`,
    `checked ${result.checkedCount}`,
    `removed ${result.removedCount}`,
    `remaining ${result.remainingCount}`,
    `kept ${result.keptCount}`
  ].join(', ')
}

function formatManualVacanciesCleanupForHuman(
  result: ManualVacanciesCleanupResult | undefined
): string | undefined {
  if (!result) {
    return undefined
  }

  if (result.skipped) {
    return 'Ручной список вакансий: список был пуст.'
  }

  return (
    [
      `Ручной список вакансий: успешно удалено ${result.removedCount}`,
      `проверено ${result.checkedCount}`,
      `осталось ${result.remainingCount}`
    ].join(', ') + '.'
  )
}

function isAutoResponderStopNormal(status: OrchestratorStatus): boolean {
  if (status.autoResponderStopReason === 'orchestrator_stop_after_watch') {
    return Boolean(
      status.autoResponderWatchTimedOut &&
      status.profileStopped &&
      status.profileTagRemoved &&
      status.profileStatusRestored &&
      !status.error &&
      !status.telegramError
    )
  }

  return Boolean(
    status.autoResponderStopReason &&
    NORMAL_AUTO_RESPONDER_STOP_REASONS.has(status.autoResponderStopReason)
  )
}

function formatParserErrorCodesForTelegram(
  status: OrchestratorStatus
): string | undefined {
  if (isAutoResponderStopNormal(status) || !status.parserErrorCodes?.length) {
    return undefined
  }

  return `Parser error codes: ${escapeTelegramHtml(status.parserErrorCodes.join(', '))}`
}

function formatRecentUrlsForTelegram(
  status: OrchestratorStatus
): string | undefined {
  if (!status.recentUrls?.length) {
    return undefined
  }

  const lines = status.recentUrls.slice(-2).map((entry, index) => {
    const marker =
      index === status.recentUrls!.slice(-2).length - 1 ? 'current' : 'previous'
    const reason = entry.reason ? ` (${escapeTelegramHtml(entry.reason)})` : ''

    return `${escapeTelegramHtml(marker)}${reason}: ${formatTelegramLink(entry.url)}`
  })

  return ['Recent URLs:', ...lines].join('\n')
}

function formatAuthCheckBrief(check: HhAuthCheck): string {
  const signalNames = Object.entries(check.signals)
    .filter(([, signal]) => signal.exists)
    .map(([name]) => name)

  return `${check.state}; signals ${signalNames.join(', ') || 'none'}; url ${check.url}`
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

function getBestHHAuthCheck(result: any): HhAuthCheck {
  return convertHHAuthResultToCheck(
    result?.finalHeadless ??
      result?.headfullAfterLogin ??
      result?.initialHeadless ??
      result
  )
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

function shouldSendParserLogsToTelegram(
  status: OrchestratorStatus,
  parserLogs: ParserLogEntry[]
): boolean {
  return Boolean(
    LOGS_CHANNEL_ID && parserLogs.length && !isAutoResponderStopNormal(status)
  )
}

function formatLifecycleEventForTelegram(
  status: OrchestratorStatus,
  item: LifecycleEvent
): string {
  let details = item.details

  if (details && item.event.startsWith('HH auth checked')) {
    details = details.split(';')[0]
  }

  if (isAutoResponderStopNormal(status) && details) {
    details = details
      .replace(/, parser errors \d+, parser codes .*?(?=, stop reason)/, '')
      .replace(/, parser errors \d+(?=, stop reason)/, '')
  }

  const line = `${formatElapsed(item.elapsedMs)} ${item.event}${details ? `: ${details}` : ''}`

  return replaceUrlsWithTelegramLinks(truncateTelegramLine(line, 220), 'link')
}

function writeLocalRunLog(record: LocalRunLogRecord): void {
  try {
    fsSync.mkdirSync(LOCAL_RUN_LOG_DIR, {
      recursive: true
    })
    fsSync.appendFileSync(
      LOCAL_RUN_LOG_FILE,
      `${JSON.stringify({
        runId: LOCAL_RUN_ID,
        at: new Date().toISOString(),
        pid: process.pid,
        ...record
      })}\n`,
      'utf8'
    )
  } catch (error: unknown) {
    console.error(`Failed to write local run log: ${getErrorMessage(error)}`)
  }
}

function addLifecycleEvent(
  status: OrchestratorStatus,
  runStartedAt: number,
  event: string,
  details?: string
): OrchestratorStatus {
  const lifecycleEvent = {
    at: new Date().toISOString(),
    elapsedMs: Date.now() - runStartedAt,
    event,
    details
  }

  writeLocalRunLog({
    kind: 'client-lifecycle',
    clientName: status.clientName,
    market: status.market,
    stack: status.stack,
    dolphinProfileId: status.dolphinProfileId,
    event: lifecycleEvent
  })

  return {
    ...status,
    lifecycleEvents: [...status.lifecycleEvents, lifecycleEvent]
  }
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

function formatClientErrorLog(status: OrchestratorStatus): string {
  const lines = [
    '<b>HH autoparcer error</b>',
    `Client: ${escapeTelegramHtml(status.clientName)}${status.market ? ` / ${escapeTelegramHtml(status.market)}` : ''}`,
    `Stack: ${escapeTelegramHtml(status.stack)}`,
    `Dolphin profile: ${escapeTelegramHtml(status.dolphinProfileId)}`,
    status.error ? `Error: ${escapeTelegramHtml(status.error)}` : undefined,
    status.telegramError
      ? `Telegram report error: ${escapeTelegramHtml(status.telegramError)}`
      : undefined,
    '',
    'Status:',
    formatStatusFlag('opened', status.opened),
    formatStatusFlag('indexScriptInjected', status.indexScriptInjected),
    formatStatusFlag('startButtonClicked', status.startButtonClicked),
    formatStatusFlag('autoResponderFinished', status.autoResponderFinished),
    formatStatusFlag(
      'autoResponderWatchTimedOut',
      status.autoResponderWatchTimedOut
    ),
    `Stop reason: ${escapeTelegramHtml(status.autoResponderStopReason ?? 'n/a')}`,
    status.autoResponderStopReasonDetails
      ? `Stop reason details: ${escapeTelegramHtml(status.autoResponderStopReasonDetails)}`
      : undefined,
    formatStatusFlag('stopButtonClicked', status.stopButtonClicked),
    formatStatusFlag('profileStopped', status.profileStopped),
    formatStatusFlag('profileTagAdded', status.profileTagAdded),
    formatStatusFlag('profileTagRemoved', status.profileTagRemoved),
    formatStatusFlag(
      'profileTagVerifiedAfterAdd',
      status.profileTagVerifiedAfterAdd
    ),
    formatStatusFlag(
      'profileTagVerifiedAfterRemove',
      status.profileTagVerifiedAfterRemove
    ),
    formatStatusFlag('profileStatusApplied', status.profileStatusApplied),
    formatStatusFlag('profileStatusRestored', status.profileStatusRestored),
    formatStatusFlag('manualVacanciesSent', status.manualVacanciesSent),
    `Confirmed responses: ${status.responseCount ?? 'n/a'}`,
    `Viewed vacancies: ${status.vacancyTransitionCount ?? 'n/a'}`,
    `Manual vacancies: ${status.manualVacanciesCount ?? 'n/a'}`,
    formatManualVacanciesCleanupBrief(status.manualVacanciesCleanup),
    formatAuthStatusForTelegram(status),
    formatParserErrorCodesForTelegram(status),
    formatRecentUrlsForTelegram(status),
    status.pageUrl ? `Page: ${formatTelegramLink(status.pageUrl)}` : undefined,
    status.errorStack
      ? `\nStack trace:\n${escapeTelegramHtml(status.errorStack)}`
      : undefined
  ].filter((line): line is string => line !== undefined)

  return truncateText(lines.join('\n'), TELEGRAM_MESSAGE_LIMIT)
}

function formatClientLifecycleLog(status: OrchestratorStatus): string {
  const recentLifecycleEvents = status.lifecycleEvents.slice(-8)
  const lifecycleQuote = recentLifecycleEvents.length
    ? [
        `Last lifecycle events: ${recentLifecycleEvents.length}/${status.lifecycleEvents.length}`,
        `<blockquote expandable>${recentLifecycleEvents.map(item => formatLifecycleEventForTelegram(status, item)).join('\n')}</blockquote>`
      ].join('\n')
    : undefined
  const lines = [
    '<b>HH autoparcer lifecycle</b>',
    `Client: ${escapeTelegramHtml(status.clientName)}${status.market ? ` / ${escapeTelegramHtml(status.market)}` : ''}`,
    `Dolphin profile: ${escapeTelegramHtml(status.dolphinProfileId)}`,
    `Result: ${formatTechnicalRunResult(status)}`,
    `Stop reason: ${escapeTelegramHtml(status.autoResponderStopReason ?? 'n/a')}`,
    `Responses: ${status.responseCount ?? 'n/a'}`,
    `Viewed: ${status.vacancyTransitionCount ?? 'n/a'}`,
    `Manual: ${status.manualVacanciesCount ?? 'n/a'}`,
    formatManualVacanciesCleanupBrief(status.manualVacanciesCleanup),
    formatAuthStatusForTelegram(status),
    formatParserErrorCodesForTelegram(status),
    formatRecentUrlsForTelegram(status),
    '',
    lifecycleQuote,
    status.error ? `\nError: ${escapeTelegramHtml(status.error)}` : undefined,
    status.telegramError
      ? `Telegram report error: ${escapeTelegramHtml(status.telegramError)}`
      : undefined
  ].filter((line): line is string => line !== undefined)

  return truncateText(lines.join('\n'), TELEGRAM_MESSAGE_LIMIT)
}

async function sendClientLifecycleLog(
  status: OrchestratorStatus
): Promise<void> {
  if (!LOGS_CHANNEL_ID) {
    return
  }

  try {
    await sendTelegramMessage(
      LOGS_CHANNEL_ID,
      formatClientLifecycleLog(status),
      {
        parseMode: 'html'
      }
    )
  } catch (error: unknown) {
    console.error(
      `Failed to send lifecycle log to Telegram: ${getErrorMessage(error)}`
    )
  }
}

function formatParserLogsMessage(
  status: OrchestratorStatus,
  parserLogs: ParserLogEntry[]
): string {
  const recentLogs = parserLogs.slice(-5)
  const errorLogs = parserLogs.filter(entry => entry.isError)
  const lines = [
    '<b>HH autoparcer parser logs</b>',
    `Client: ${escapeTelegramHtml(status.clientName)}${status.market ? ` / ${escapeTelegramHtml(status.market)}` : ''}`,
    `Dolphin profile: ${escapeTelegramHtml(status.dolphinProfileId)}`,
    `Parser logs: ${parserLogs.length}`,
    `Parser error logs: ${errorLogs.length}`,
    `Stop reason: ${escapeTelegramHtml(status.autoResponderStopReason ?? 'n/a')}`,
    `Responses: ${status.responseCount ?? 'n/a'}`,
    `Viewed: ${status.vacancyTransitionCount ?? 'n/a'}`,
    `Manual: ${status.manualVacanciesCount ?? 'n/a'}`,
    formatManualVacanciesCleanupBrief(status.manualVacanciesCleanup),
    formatAuthStatusForTelegram(status),
    formatParserErrorCodesForTelegram(status),
    formatRecentUrlsForTelegram(status),
    '',
    'Recent parser log lines:',
    ...recentLogs.map(entry => {
      const marker = entry.isError ? 'ERROR' : 'INFO'
      const time =
        entry.time ??
        (entry.ts
          ? new Date(Number(entry.ts)).toLocaleTimeString('ru-RU')
          : 'unknown')
      const message = String(entry.message ?? '').trim() || '(empty)'

      return `[${escapeTelegramHtml(time)}] ${marker}: ${replaceUrlsWithTelegramLinks(message)}`
    })
  ]

  return truncateText(lines.join('\n'), TELEGRAM_MESSAGE_LIMIT)
}

async function sendParserLogsToTelegram(
  status: OrchestratorStatus,
  parserLogs: ParserLogEntry[]
): Promise<void> {
  if (!shouldSendParserLogsToTelegram(status, parserLogs)) {
    return
  }

  const chunks = splitTelegramMessage(
    formatParserLogsMessage(status, parserLogs)
  )

  for (let index = 0; index < chunks.length; index += 1) {
    const suffix =
      chunks.length > 1 ? `\n\nPart ${index + 1}/${chunks.length}` : ''

    await sendTelegramMessage(LOGS_CHANNEL_ID, `${chunks[index]}${suffix}`, {
      parseMode: 'html'
    })
  }
}

async function sendClientErrorLog(status: OrchestratorStatus): Promise<void> {
  if (!LOGS_CHANNEL_ID || !hasClientFailure(status)) {
    return
  }

  try {
    await sendTelegramMessage(LOGS_CHANNEL_ID, formatClientErrorLog(status), {
      parseMode: 'html'
    })
  } catch (error: unknown) {
    console.error(
      `Failed to send error log to Telegram: ${getErrorMessage(error)}`
    )
  }
}

async function sendRunErrorLog(error: unknown): Promise<void> {
  if (!LOGS_CHANNEL_ID) {
    return
  }

  const message = truncateText(
    [
      '<b>HH autoparcer fatal error</b>',
      `Error: ${escapeTelegramHtml(getErrorMessage(error))}`,
      getErrorStack(error)
        ? `\nStack trace:\n${escapeTelegramHtml(getErrorStack(error))}`
        : undefined
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n'),
    TELEGRAM_MESSAGE_LIMIT
  )

  try {
    await sendTelegramMessage(LOGS_CHANNEL_ID, message, {
      parseMode: 'html'
    })
  } catch (telegramError: unknown) {
    console.error(
      `Failed to send fatal error log to Telegram: ${getErrorMessage(telegramError)}`
    )
  }
}

function formatHumanStopReason(status: OrchestratorStatus): string {
  if (status.error) {
    return `ошибка: ${status.error}`
  }

  if (status.telegramError) {
    return `отработал, но не удалось отправить сообщение клиенту: ${status.telegramError}`
  }

  if (!status.opened) {
    return 'не удалось открыть профиль или HH'
  }

  if (!status.startButtonClicked) {
    return 'не удалось нажать старт автооткликов'
  }

  switch (status.autoResponderStopReason) {
    case 'orchestrator_stop_after_watch':
      return 'завершили по таймеру'
    case 'hh_response_daily_limit_exceeded':
      return 'достигнут дневной лимит HH, остановили'
    case 'targets_processed':
      return 'обработал доступные вакансии'
    case 'no_new_targets':
      return 'новых вакансий для запуска не осталось'
    case 'limit_reached':
      return 'достигнут внутренний лимит сценария'
    case 'user_stop':
      return 'остановлен вручную'
    case 'vacancy_processing_error':
      return `остановился на обработке вакансии${status.autoResponderStopReasonDetails ? `: ${status.autoResponderStopReasonDetails}` : ''}`
    default:
      return status.autoResponderStopReason
        ? `остановился: ${status.autoResponderStopReason}`
        : 'нет финальной причины остановки'
  }
}

function formatHumanRunResult(status: OrchestratorStatus): string {
  if (hasClientFailure(status)) {
    return '🔴 нужно проверить'
  }

  if (status.autoResponderStopReason === 'hh_response_daily_limit_exceeded') {
    return '🟢 лимит HH'
  }

  return '🟢 ок'
}

function formatTechnicalRunResult(status: OrchestratorStatus): string {
  return hasClientFailure(status) ? '🔴 ERROR' : '🟢 OK'
}

function formatRunSummaryLog(results: OrchestratorStatus[]): string {
  const successful = results.filter(status => !hasClientFailure(status))
  const failed = results.filter(hasClientFailure)
  const responseCount = results.reduce(
    (sum, status) => sum + (status.responseCount ?? 0),
    0
  )
  const manualCount = results.reduce(
    (sum, status) => sum + (status.manualVacanciesCount ?? 0),
    0
  )
  const rows = results.map(status => {
    const name = `${status.clientName}${status.market ? ` / ${status.market}` : ''}`
    const pieces = [
      `${escapeTelegramHtml(name)}: ${escapeTelegramHtml(formatHumanRunResult(status))}`,
      escapeTelegramHtml(formatHumanStopReason(status)),
      `откликов: ${status.responseCount ?? 0}`,
      `ручных: ${status.manualVacanciesCount ?? 0}`
    ]

    return pieces.join(', ')
  })

  return truncateText(
    [
      '<b>Итоги автооткликов</b>',
      `Профилей: ${results.length}`,
      `🟢 Ок: ${successful.length}`,
      `🔴 Нужно проверить: ${failed.length}`,
      `Откликов всего: ${responseCount}`,
      `Ручных вакансий всего: ${manualCount}`,
      '',
      ...rows
    ].join('\n'),
    TELEGRAM_MESSAGE_LIMIT
  )
}

async function sendRunSummaryLog(results: OrchestratorStatus[]): Promise<void> {
  if (!SUMMARY_LOGS_CHANNEL_ID) {
    return
  }

  try {
    await sendTelegramMessage(
      SUMMARY_LOGS_CHANNEL_ID,
      formatRunSummaryLog(results),
      {
        parseMode: 'html'
      }
    )
  } catch (error: unknown) {
    console.error(
      `Failed to send run summary to Telegram: ${getErrorMessage(error)}`
    )
  }
}

function hasClientFailure(status: OrchestratorStatus): boolean {
  return Boolean(
    status.error ||
    status.telegramError ||
    !status.opened ||
    !status.startButtonClicked ||
    !isAutoResponderStopNormal(status)
  )
}

function isClientReportSuccessful(status: OrchestratorStatus): boolean {
  if (
    status.error ||
    status.telegramError ||
    !status.opened ||
    !status.startButtonClicked
  ) {
    return false
  }

  if (status.autoResponderStopReason === 'orchestrator_stop_after_watch') {
    return Boolean(
      status.autoResponderWatchTimedOut &&
      !status.error &&
      !status.telegramError
    )
  }

  return Boolean(
    status.autoResponderStopReason &&
    NORMAL_AUTO_RESPONDER_STOP_REASONS.has(status.autoResponderStopReason)
  )
}

function formatManualVacanciesMessage(
  clientName: string,
  vacancies: ManualVacancy[],
  _responseCount: number,
  _vacancyTransitionCount: number,
  isSuccessful = true,
  manualVacanciesCleanup?: ManualVacanciesCleanupResult
): string {
  const resultEmoji = isSuccessful ? '🟢' : '🔴'
  const manualVacanciesCleanupLine = formatManualVacanciesCleanupForHuman(
    manualVacanciesCleanup
  )
  const summary = [
    `<b>${resultEmoji} ${escapeTelegramHtml(clientName)}: итоги автооткликов</b>`,
    `Вакансий для ручного отклика: ${vacancies.length}`,
    manualVacanciesCleanupLine
      ? escapeTelegramHtml(manualVacanciesCleanupLine)
      : undefined,
    'Отклики на ру рынке стабилизированы. Если видите баги, репортите, будем чинить!',
    'Апдейты: успешно откликнутые вакансии для мануального отклика больше не попадают в выборку.'
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')

  if (!vacancies.length) {
    return `${summary}\n\nСписок вакансий для ручного отклика пуст.`
  }

  const rows = vacancies.map((item, index) => {
    const savedAt = item.ts
      ? new Date(Number(item.ts)).toLocaleString('ru-RU')
      : 'unknown time'
    const vacancyId = item.vid || 'n/a'

    return [
      `${index + 1}. ID: ${formatTelegramLink(item.url, vacancyId)}`,
      `Saved: ${escapeTelegramHtml(savedAt)}`
    ]
      .filter(Boolean)
      .join('\n')
  })

  return [summary, ...rows].join('\n\n')
}

async function sendManualVacanciesToTelegram(
  chatId: string,
  clientName: string,
  vacancies: ManualVacancy[],
  responseCount: number,
  vacancyTransitionCount: number,
  isSuccessful = true,
  manualVacanciesCleanup?: ManualVacanciesCleanupResult
): Promise<void> {
  const chunks = splitTelegramMessage(
    formatManualVacanciesMessage(
      clientName,
      vacancies,
      responseCount,
      vacancyTransitionCount,
      isSuccessful,
      manualVacanciesCleanup
    )
  )

  for (let index = 0; index < chunks.length; index += 1) {
    const suffix =
      chunks.length > 1 ? `\n\nPart ${index + 1}/${chunks.length}` : ''

    await sendTelegramMessage(chatId, `${chunks[index]}${suffix}`, {
      parseMode: 'html'
    })
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getRecommendedExternalTimeoutMs(
  clientCount: number,
  watchMs = AUTO_RESPONDER_WATCH_MS,
  clientStartDelayMs = CLIENT_START_DELAY_MS
): number {
  const staggerTotalMs = Math.max(clientCount - 1, 0) * clientStartDelayMs
  const profileBufferMs = clientCount * EXTERNAL_TIMEOUT_PROFILE_BUFFER_MS

  return Math.ceil(
    (watchMs + staggerTotalMs + profileBufferMs) * EXTERNAL_TIMEOUT_MULTIPLIER
  )
}

function getRunningDolphinBrowserProfileIds(): number[] {
  const command = [
    '$ErrorActionPreference = "Stop";',
    'Get-CimInstance Win32_Process',
    "| Where-Object { $_.Name -eq 'anty.exe' -and $_.CommandLine -match 'browser_profiles\\\\\\d+\\\\data_dir' }",
    "| ForEach-Object { if ($_.CommandLine -match 'browser_profiles\\\\(\\d+)\\\\data_dir') { $Matches[1] } }",
    '| Sort-Object -Unique',
    '| ConvertTo-Json'
  ].join(' ')
  const stdout = childProcess
    .execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        encoding: 'utf8'
      }
    )
    .trim()

  if (!stdout) {
    return []
  }

  const parsed = JSON.parse(stdout)
  const ids = Array.isArray(parsed) ? parsed : [parsed]

  return ids.map(id => Number(id)).filter(id => Number.isFinite(id))
}

async function assertPreexistingDolphinProfileLimit(): Promise<void> {
  const runningProfileIds = getRunningDolphinBrowserProfileIds()

  if (runningProfileIds.length > MAX_PREEXISTING_DOLPHIN_PROFILES) {
    throw new Error(
      `Too many Dolphin profiles are already open before automation start: ` +
        `${runningProfileIds.length}/${MAX_PREEXISTING_DOLPHIN_PROFILES}. ` +
        `Open profile ids: ${runningProfileIds.join(', ')}`
    )
  }

  console.log(
    `Preflight Dolphin profiles: ${runningProfileIds.length}/${MAX_PREEXISTING_DOLPHIN_PROFILES}` +
      (runningProfileIds.length ? ` (${runningProfileIds.join(', ')})` : '')
  )
}

async function assertDolphinAppRunning(): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    DOLPHIN_LOCAL_API_HEALTH_TIMEOUT_MS
  )

  try {
    await fetch(`${DOLPHIN_LOCAL_API_BASE_URL}/browser_profiles`, {
      method: 'GET',
      signal: controller.signal
    })
  } catch (error: unknown) {
    throw new Error(
      `Dolphin Anty app is not reachable at ${DOLPHIN_LOCAL_API_BASE_URL}. ` +
        `Open Dolphin Anty and wait until the local API on port 3001 is ready, then rerun. ` +
        `Original error: ${getErrorMessage(error)}`
    )
  } finally {
    clearTimeout(timeout)
  }

  console.log(
    `Preflight Dolphin app: local API is reachable at ${DOLPHIN_LOCAL_API_BASE_URL}`
  )
}

async function requestLocalDolphin<T>(
  endpointPath: string,
  options: {
    method?: 'GET' | 'POST'
    body?: unknown
  } = {}
): Promise<T> {
  const response = await fetch(`${DOLPHIN_LOCAL_API_BASE_URL}${endpointPath}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const responseText = await response.text()
  let data: any = null

  try {
    data = responseText ? JSON.parse(responseText) : null
  } catch {
    data = responseText
  }

  if (!response.ok) {
    const message =
      stringifyApiMessage(data?.error) ||
      stringifyApiMessage(data?.message) ||
      stringifyApiMessage(data) ||
      `Dolphin local API failed: ${response.status} ${response.statusText}`

    const error = new Error(message) as Error & { details?: any }
    error.details = data

    throw error
  }

  return data as T
}

async function getDolphinProfile(
  profileId: number
): Promise<DolphinBrowserProfile> {
  const response = await requestDolphinCloudApi<DolphinProfileResponse>(
    `/browser_profiles/${profileId}`
  )

  if (!response.data) {
    throw new Error(`Dolphin profile ${profileId} was not returned by API`)
  }

  return response.data
}

async function getDolphinProfileTags(profileId: number): Promise<string[]> {
  const profile = await getDolphinProfile(profileId)

  return Array.isArray(profile.tags) ? profile.tags : []
}

async function updateDolphinProfileTags(
  profileId: number,
  tags: string[]
): Promise<void> {
  await requestDolphinCloudApi<DolphinProfileResponse>(
    `/browser_profiles/${profileId}`,
    {
      method: 'PATCH',
      body: {
        tags
      }
    }
  )
}

function getDolphinProfileStatusId(
  profile: DolphinBrowserProfile
): number | null {
  const statusId = Number(profile.status?.id)

  return Number.isFinite(statusId) ? statusId : null
}

async function ensureAutomationLockStatusId(): Promise<number> {
  if (automationLockStatusId !== undefined) {
    return automationLockStatusId
  }

  const statuses =
    await requestDolphinCloudApi<DolphinProfileStatusListResponse>(
      '/browser_profiles/statuses?limit=50'
    )
  const existingStatus = statuses.data?.find(
    status =>
      status.name === AUTOMATION_LOCK_STATUS_NAME && status.deleted !== 1
  )
  const existingStatusId = Number(existingStatus?.id)

  if (Number.isFinite(existingStatusId)) {
    automationLockStatusId = existingStatusId
    return automationLockStatusId
  }

  const createdStatus =
    await requestDolphinCloudApi<DolphinProfileStatusResponse>(
      '/browser_profiles/statuses',
      {
        method: 'POST',
        body: {
          name: AUTOMATION_LOCK_STATUS_NAME,
          color: AUTOMATION_LOCK_STATUS_COLOR,
          type: 'common'
        }
      }
    )
  const createdStatusId = Number(createdStatus.data?.id)

  if (!Number.isFinite(createdStatusId)) {
    throw new Error(
      `Dolphin automation status was not created: ${AUTOMATION_LOCK_STATUS_NAME}`
    )
  }

  automationLockStatusId = createdStatusId
  return automationLockStatusId
}

async function updateDolphinProfileStatus(
  profileId: number,
  statusId: number | null
): Promise<void> {
  await requestDolphinCloudApi<DolphinProfileResponse>(
    `/browser_profiles/${profileId}`,
    {
      method: 'PATCH',
      body: {
        statusId: statusId ?? 0
      }
    }
  )

  const verifiedStatusId = getDolphinProfileStatusId(
    await getDolphinProfile(profileId)
  )

  if (verifiedStatusId !== statusId) {
    throw new Error(
      `Dolphin profile ${profileId} status was not updated: expected ${String(statusId)}, got ${String(verifiedStatusId)}`
    )
  }
}

async function addDolphinProfileTag(
  profileId: number,
  tag: string
): Promise<void> {
  const tags = await getDolphinProfileTags(profileId)

  if (!tags.includes(tag)) {
    await updateDolphinProfileTags(profileId, [...tags, tag])
  }

  const verifiedTags = await getDolphinProfileTags(profileId)

  if (!verifiedTags.includes(tag)) {
    throw new Error(`Dolphin profile ${profileId} tag was not applied: ${tag}`)
  }
}

async function removeDolphinProfileTag(
  profileId: number,
  tag: string
): Promise<void> {
  const tags = await getDolphinProfileTags(profileId)
  const nextTags = tags.filter(item => item !== tag)

  if (nextTags.length !== tags.length) {
    await updateDolphinProfileTags(profileId, nextTags)
  }

  const verifiedTags = await getDolphinProfileTags(profileId)

  if (verifiedTags.includes(tag)) {
    throw new Error(`Dolphin profile ${profileId} tag was not removed: ${tag}`)
  }
}

async function stopDolphinProfile(profileId: number): Promise<void> {
  await requestLocalDolphin(`/browser_profiles/${profileId}/stop`)
  startedProfileIds.delete(profileId)
}

function isAlreadyRunningError(error: any): boolean {
  const duplicateCode = error?.details?.errorObject?.code
  const message = String(
    error?.message ?? error?.details?.error ?? error?.details?.message ?? ''
  ).toLowerCase()

  return (
    duplicateCode === 'E_BROWSER_RUN_DUPLICATE' ||
    message.includes('already running')
  )
}

function isAlreadyRunningResponse(response: DolphinStartResponse): boolean {
  const message = String(
    response.error ?? response.errorObject?.text ?? ''
  ).toLowerCase()

  return (
    response.errorObject?.code === 'E_BROWSER_RUN_DUPLICATE' ||
    message.includes('already running')
  )
}

async function requestDolphinProfileStart(
  profileId: number,
  body: {
    automation: boolean
    headless: boolean
  }
): Promise<DolphinStartResponse> {
  const response = await requestLocalDolphin<DolphinStartResponse>(
    `/browser_profiles/${profileId}/start`,
    {
      method: 'POST',
      body
    }
  )

  if (response.success === false || isAlreadyRunningResponse(response)) {
    const error = new Error(
      response.error ||
        response.errorObject?.text ||
        'Dolphin profile start failed'
    ) as Error & {
      details?: DolphinStartResponse
    }
    error.details = response

    throw error
  }

  return response
}

async function startDolphinProfileWithHeadless(
  profileId: number,
  headless: boolean
): Promise<DolphinStartResponse> {
  const body = {
    automation: true,
    headless
  }
  const maxAttempts = DOLPHIN_PROFILE_START_MAX_ATTEMPTS

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await requestDolphinProfileStart(profileId, body)
      startedProfileIds.add(profileId)

      return response
    } catch (error: any) {
      if (!isAlreadyRunningError(error) || attempt === maxAttempts) {
        throw error
      }

      const retryDelayMs = DOLPHIN_PROFILE_START_RETRY_BASE_MS * attempt
      console.warn(
        `Dolphin profile ${profileId} is still running before start attempt ` +
          `${attempt + 1}/${maxAttempts}; stopping and waiting ${retryDelayMs}ms`
      )
      await stopDolphinProfile(profileId).catch(() => undefined)
      await wait(retryDelayMs)
    }
  }

  throw new Error(
    `Dolphin profile ${profileId} did not start after ${maxAttempts} attempts`
  )
}

async function startDolphinProfile(
  profileId: number
): Promise<DolphinStartResponse> {
  return await startDolphinProfileWithHeadless(profileId, DOLPHIN_HEADLESS)
}

async function startDolphinProfileForAuth(
  profileId: number,
  mode: 'headless' | 'headfull'
): Promise<{ profileId: number; mode: 'headless' | 'headfull'; port: number }> {
  const response = await startDolphinProfileWithHeadless(
    profileId,
    mode === 'headless'
  )
  const port = response.automation?.port

  if (!port) {
    throw new Error(
      `Dolphin did not return an automation port for HH auth profile ${profileId}`
    )
  }

  return {
    profileId,
    mode,
    port
  }
}

async function connectToDolphinStartedProfile(startedProfile: {
  port: number
}): Promise<any> {
  const { chromium } = loadPlaywright()

  return await chromium.connectOverCDP(
    `http://127.0.0.1:${startedProfile.port}`,
    {
      timeout: CONNECT_OVER_CDP_TIMEOUT_MS
    }
  )
}

async function ensureHHAuthForClient(
  clientData: ClientAutomationData
): Promise<HhAuthCheck> {
  const hhAuth = makeHHAuth({
    artifactDir: getHHAuthArtifactDir(clientData),
    errorArtifactDir: getHHAuthErrorArtifactDir(clientData),
    connectToProfile: connectToDolphinStartedProfile,
    getCredentials: async () => {
      const credentials =
        clientData.hhAuthCredentials ??
        (await getClientHHAuthCredentials(clientData.clientName, clientData.market))

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
    startProfile: startDolphinProfileForAuth,
    stopProfile: stopDolphinProfile,
    timeoutMs: HH_AUTH_TIMEOUT_MS
  })
  const result = await hhAuth.ensureAuthorized(clientData.dolphinProfileId)

  return getBestHHAuthCheck(result)
}

async function openScenarioAndInjectIndex(
  port: number,
  stackScenario: string,
  responseCounter: ResponseCounter,
  coverText?: string
): Promise<OpenScenarioResult> {
  const { chromium } = loadPlaywright()
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
    timeout: CONNECT_OVER_CDP_TIMEOUT_MS
  })
  let browserDisconnected = false
  browser.on('disconnected', () => {
    browserDisconnected = true
  })
  const context = browser.contexts()[0] || (await browser.newContext())
  const cleanupPage = await context.newPage()
  let manualVacanciesCleanup: ManualVacanciesCleanupResult | undefined

  try {
    manualVacanciesCleanup = await runManualVacanciesCleanup(cleanupPage, {
      log: (message: string) =>
        console.log(`[manual vacancies cleanup] ${message}`)
    })
  } finally {
    await cleanupPage.close().catch(() => undefined)
  }

  if (!manualVacanciesCleanup) {
    throw new Error('Manual vacancies cleanup did not return a result')
  }

  if (!manualVacanciesCleanup.completed) {
    console.log(
      `[manual vacancies cleanup] Manual vacancies cleanup left ` +
        `${manualVacanciesCleanup.remainingCount} pending entries; ` +
        `continuing standard scenario`
    )
  }

  const page = await context.newPage()
  const indexScript = await fs.readFile(INDEX_SCRIPT_PATH, 'utf8')
  const disposeWatcher = installIndexReinjectWatcher(
    page,
    indexScript,
    responseCounter
  )

  await page.goto(stackScenario, {
    waitUntil: 'domcontentloaded',
    timeout: HH_INITIAL_NAVIGATION_TIMEOUT_MS
  })
  await page
    .waitForLoadState('load', {
      timeout: HH_INITIAL_NAVIGATION_TIMEOUT_MS
    })
    .catch(() => undefined)

  const pageTitle = await page.title()
  const pageUrl = page.url()
  recordVacancyTransition(responseCounter, pageUrl)
  const opened = isAutoResponderUrl(pageUrl)
  const authBeforeStart = await detectHhAuthState(page)

  if (!opened) {
    return {
      page,
      disposeWatcher,
      isBrowserDisconnected: () => browserDisconnected,
      result: {
        opened,
        indexScriptInjected: false,
        watcherInstalled: true,
        startButtonClicked: false,
        pageTitle,
        pageUrl,
        manualVacanciesCleanup,
        authBeforeStart
      }
    }
  }

  await page.evaluate((successfulResponsesKey: string) => {
    sessionStorage.setItem(successfulResponsesKey, '0')
  }, HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSES_KEY)
  await applyAutoResponderCoverText(page, coverText)
  const indexScriptInjected = await ensureIndexScript(
    page,
    indexScript,
    'initial load'
  )
  await page.waitForSelector('#ar-start-btn', {
    state: 'visible',
    timeout: 10000
  })
  await page.evaluate(() => {
    const startButton = document.getElementById(
      'ar-start-btn'
    ) as HTMLButtonElement | null

    if (!startButton) {
      throw new Error('Start button was not found')
    }

    startButton.click()
  })

  return {
    page,
    disposeWatcher,
    isBrowserDisconnected: () => browserDisconnected,
    result: {
      opened,
      indexScriptInjected,
      watcherInstalled: true,
      startButtonClicked: true,
      pageTitle,
      pageUrl,
      manualVacanciesCleanup,
      authBeforeStart
    }
  }
}

async function runClientOrchestrator(
  clientData: ClientAutomationData
): Promise<OrchestratorStatus> {
  if (!clientData.stackScenario) {
    throw new Error(`Stack scenario for ${clientData.clientName} was not found`)
  }

  const runStartedAt = Date.now()
  let status: OrchestratorStatus = {
    clientName: clientData.clientName,
    stack: clientData.stack,
    market: clientData.market,
    dolphinProfileId: clientData.dolphinProfileId,
    commonChatId: clientData.commonChatId,
    stackScenario: clientData.stackScenario,
    lifecycleEvents: [],
    opened: false,
    indexScriptInjected: false,
    watcherInstalled: false,
    startButtonClicked: false
  }
  let disposeWatcher: (() => void) | undefined
  let profileTagAdded = false
  let profileStatusApplied = false
  let previousProfileStatusId: number | null | undefined
  const responseCounter = createResponseCounter()
  status = addLifecycleEvent(status, runStartedAt, 'client run started')

  try {
    status = addLifecycleEvent(
      status,
      runStartedAt,
      'applying automation profile lock'
    )
    const automationStatusId = await ensureAutomationLockStatusId()
    const profileBeforeLock = await getDolphinProfile(
      clientData.dolphinProfileId
    )
    const currentProfileStatusId = getDolphinProfileStatusId(profileBeforeLock)
    previousProfileStatusId =
      currentProfileStatusId === automationStatusId
        ? null
        : currentProfileStatusId

    await addDolphinProfileTag(clientData.dolphinProfileId, AUTOMATION_LOCK_TAG)
    profileTagAdded = true
    await updateDolphinProfileStatus(
      clientData.dolphinProfileId,
      automationStatusId
    )
    profileStatusApplied = true
    status = {
      ...status,
      profileTagAdded: true,
      profileTagVerifiedAfterAdd: true,
      profileStatusApplied: true
    }
    status = addLifecycleEvent(
      status,
      runStartedAt,
      'automation profile lock verified',
      `status ${automationStatusId}, previous ${String(previousProfileStatusId)}`
    )

    status = addLifecycleEvent(status, runStartedAt, 'ensuring HH auth')
    const authBeforeStart = await ensureHHAuthForClient(clientData)
    status = {
      ...status,
      authBeforeStart
    }
    status = addLifecycleEvent(
      status,
      runStartedAt,
      'HH auth ensured',
      formatAuthCheckBrief(authBeforeStart)
    )

    if (DOLPHIN_PROFILE_RELEASE_AFTER_AUTH_WAIT_MS > 0) {
      status = addLifecycleEvent(
        status,
        runStartedAt,
        'waiting for Dolphin profile release after HH auth',
        `${DOLPHIN_PROFILE_RELEASE_AFTER_AUTH_WAIT_MS}ms`
      )
      await wait(DOLPHIN_PROFILE_RELEASE_AFTER_AUTH_WAIT_MS)
    }

    status = addLifecycleEvent(status, runStartedAt, 'starting Dolphin profile')
    const startResponse = await startDolphinProfile(clientData.dolphinProfileId)
    const port = startResponse.automation?.port

    if (!port) {
      throw new Error('Dolphin did not return an automation port')
    }
    status = addLifecycleEvent(
      status,
      runStartedAt,
      'Dolphin profile started',
      `port ${port}`
    )

    status = addLifecycleEvent(status, runStartedAt, 'opening scenario')
    const pageResult = await openScenarioAndInjectIndex(
      port,
      clientData.stackScenario,
      responseCounter,
      clientData.coverText
    )
    disposeWatcher = pageResult.disposeWatcher

    status = {
      ...status,
      ...pageResult.result
    }
    if (status.manualVacanciesCleanup) {
      status = addLifecycleEvent(
        status,
        runStartedAt,
        status.manualVacanciesCleanup.skipped
          ? 'manual vacancies cleanup skipped'
          : status.manualVacanciesCleanup.completed
            ? 'manual vacancies cleanup completed'
            : 'manual vacancies cleanup kept pending entries',
        formatManualVacanciesCleanupBrief(status.manualVacanciesCleanup)
      )
    }
    if (status.authBeforeStart) {
      status = addLifecycleEvent(
        status,
        runStartedAt,
        'HH auth checked before start',
        formatAuthCheckBrief(status.authBeforeStart)
      )
    }
    status = addLifecycleEvent(
      status,
      runStartedAt,
      status.startButtonClicked
        ? 'auto responder started'
        : 'scenario opened without start',
      pageResult.result.pageUrl
    )

    if (status.startButtonClicked) {
      const autoResponderResult = await waitForAutoResponderToFinish(
        pageResult.page,
        AUTO_RESPONDER_WATCH_MS,
        pageResult.isBrowserDisconnected
      )

      status = {
        ...status,
        autoResponderFinished: autoResponderResult.finished,
        autoResponderWatchTimedOut: autoResponderResult.timedOut
      }
      status = addLifecycleEvent(
        status,
        runStartedAt,
        autoResponderResult.finished
          ? 'auto responder finished itself'
          : 'auto responder watch timeout'
      )

      if (
        autoResponderResult.browserDisconnected ||
        autoResponderResult.pageClosed
      ) {
        throw new Error(
          autoResponderResult.browserDisconnected
            ? 'Browser CDP connection was closed while auto responder was running'
            : 'Page was closed while auto responder was running'
        )
      }

      try {
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'stopping auto responder'
        )
        const stopButtonClicked = await stopAutoResponder(pageResult.page)
        const stopReason = await getAutoResponderStopReason(pageResult.page)
        const manualVacancies = await getManualVacancies(pageResult.page)
        const responseCount = await getAutoResponderSuccessCount(
          pageResult.page
        )
        const parserLogs = await getParserLogs(pageResult.page)
        const structuredParserErrors = await getAutoResponderParserErrors(
          pageResult.page
        )
        const storedRecentUrls = await getAutoResponderRecentUrls(
          pageResult.page
        )
        const recentUrls = storedRecentUrls.length
          ? storedRecentUrls
          : (stopReason?.recentUrls ?? [])
        const parserErrorLogsCount = parserLogs.filter(
          entry => entry.isError
        ).length
        const parserErrorCodes = [
          ...new Set([
            ...structuredParserErrors
              .map(entry => entry.code)
              .filter((code): code is string => Boolean(code)),
            ...extractParserErrorCodesFromLogs(parserLogs)
          ])
        ]
        const parserLastErrorCode =
          structuredParserErrors
            .map(entry => entry.code)
            .filter((code): code is string => Boolean(code))
            .at(-1) ?? parserErrorCodes.at(-1)
        const vacancyTransitionCount = responseCounter.vacancyIds.size

        status = {
          ...status,
          stopButtonClicked,
          autoResponderStopReason: stopReason?.reason,
          autoResponderStopReasonDetails: stopReason?.details,
          responseCount,
          vacancyTransitionCount,
          manualVacanciesCount: manualVacancies.length,
          parserLogsCount: parserLogs.length,
          parserErrorLogsCount,
          parserErrorCodes,
          parserLastErrorCode,
          recentUrls
        }
        if (shouldCheckAuthAfterParserStop(status)) {
          const authAfterParserStop = await detectHhAuthState(pageResult.page)
          status = {
            ...status,
            authAfterParserStop
          }
          status = addLifecycleEvent(
            status,
            runStartedAt,
            'HH auth checked after parser stop',
            formatAuthCheckBrief(authAfterParserStop)
          )
        }
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'auto responder data collected',
          `responses ${responseCount}, viewed ${vacancyTransitionCount}, manual ${manualVacancies.length}, parser errors ${parserErrorLogsCount}, parser codes ${parserErrorCodes.join(', ') || 'n/a'}, stop reason ${stopReason?.reason ?? 'n/a'}`
        )

        status = addLifecycleEvent(
          status,
          runStartedAt,
          'sending client Telegram report'
        )
        await sendManualVacanciesToTelegram(
          clientData.commonChatId,
          `${clientData.clientName} / ${clientData.market}`,
          manualVacancies,
          responseCount,
          vacancyTransitionCount,
          isClientReportSuccessful(status),
          status.manualVacanciesCleanup
        )

        status = {
          ...status,
          manualVacanciesSent: true
        }
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'client Telegram report sent'
        )

        try {
          if (shouldSendParserLogsToTelegram(status, parserLogs)) {
            status = addLifecycleEvent(
              status,
              runStartedAt,
              'sending parser logs to logs chat'
            )
            await sendParserLogsToTelegram(status, parserLogs)
            status = {
              ...status,
              parserLogsSent: true
            }
            status = addLifecycleEvent(
              status,
              runStartedAt,
              'parser logs sent to logs chat'
            )
          } else {
            status = {
              ...status,
              parserLogsSent: false
            }
            status = addLifecycleEvent(
              status,
              runStartedAt,
              'parser logs skipped',
              isAutoResponderStopNormal(status)
                ? 'normal auto responder stop'
                : 'no parser logs'
            )
          }
        } catch (error: unknown) {
          status = {
            ...status,
            parserLogsSent: false
          }
          status = addLifecycleEvent(
            status,
            runStartedAt,
            'parser logs sending failed',
            getErrorMessage(error)
          )
          console.error(
            `Failed to send parser logs to Telegram: ${getErrorMessage(error)}`
          )
        }
      } catch (error: unknown) {
        status = {
          ...status,
          manualVacanciesSent: false,
          telegramError: getErrorMessage(error),
          errorStack: status.errorStack ?? getErrorStack(error)
        }
      }
    }
  } catch (error: unknown) {
    status = {
      ...status,
      error: getErrorMessage(error),
      errorStack: getErrorStack(error)
    }
  } finally {
    disposeWatcher?.()

    if (DOLPHIN_HEADLESS) {
      try {
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'stopping Dolphin profile'
        )
        await stopDolphinProfile(clientData.dolphinProfileId)
        status = {
          ...status,
          profileStopped: true
        }
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'Dolphin profile stopped'
        )
      } catch (error: unknown) {
        status = {
          ...status,
          profileStopped: false,
          error: status.error ?? getErrorMessage(error),
          errorStack: status.errorStack ?? getErrorStack(error)
        }
      }
    }

    if (profileTagAdded) {
      try {
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'removing automation tag'
        )
        await removeDolphinProfileTag(
          clientData.dolphinProfileId,
          AUTOMATION_LOCK_TAG
        )
        status = {
          ...status,
          profileTagRemoved: true,
          profileTagVerifiedAfterRemove: true
        }
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'automation tag removal verified'
        )
      } catch (error: unknown) {
        status = {
          ...status,
          profileTagRemoved: false,
          error: status.error ?? getErrorMessage(error),
          errorStack: status.errorStack ?? getErrorStack(error)
        }
      }
    }

    if (profileStatusApplied) {
      try {
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'restoring previous Dolphin status'
        )
        await updateDolphinProfileStatus(
          clientData.dolphinProfileId,
          previousProfileStatusId ?? null
        )
        status = {
          ...status,
          profileStatusRestored: true
        }
        status = addLifecycleEvent(
          status,
          runStartedAt,
          'previous Dolphin status restored'
        )
      } catch (error: unknown) {
        status = {
          ...status,
          profileStatusRestored: false,
          error: status.error ?? getErrorMessage(error),
          errorStack: status.errorStack ?? getErrorStack(error)
        }
      }
    }
  }

  status = addLifecycleEvent(status, runStartedAt, 'client run finished')
  writeLocalRunLog({
    kind: 'client-final-status',
    status
  })
  await sendClientLifecycleLog(status)
  await sendClientErrorLog(status)

  console.log(status)

  return status
}

async function runKiraOrchestrator(): Promise<OrchestratorStatus> {
  const repository = await createClientAutomationRepository()
  const clientData: ClientAutomationData = attachHHAuthCredentials(
    [repository.getAutomationTarget('Кира')],
    repository
  )[0]

  return runClientOrchestrator(clientData)
}

function getConfiguredClientNames(): string[] {
  return parseCommaSeparatedEnv(process.env.ORCHESTRATOR_CLIENT_NAMES)
}

function getConfiguredClientIds(): string[] {
  return parseCommaSeparatedEnv(process.env.ORCHESTRATOR_CLIENT_IDS)
}

function getConfiguredAutomationTargetOptions(): AutomationTargetOptions {
  return {
    market: ORCHESTRATOR_WORK_WITH_MARKET
  }
}

function parseCommaSeparatedEnv(value: string | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function attachHHAuthCredentials(
  clients: ClientAutomationData[],
  repository: {
    getHHAuthCredentialsByCommonChatId(
      commonChatId: string,
      market?: 'Ru' | 'En'
    ): ClientHHAuthCredentials
  }
): ClientAutomationData[] {
  return clients.map(client => ({
    ...client,
    hhAuthCredentials: repository.getHHAuthCredentialsByCommonChatId(
      client.commonChatId,
      client.market
    )
  }))
}

function selectClientsByCommonChatIds(
  allClients: ClientAutomationData[],
  clientIds: string[]
): ClientAutomationData[] {
  const selectedClients = allClients.filter(client =>
    clientIds.includes(client.commonChatId)
  )
  const selectedIds = new Set(
    selectedClients.map(client => client.commonChatId)
  )
  const missingIds = clientIds.filter(id => !selectedIds.has(id))

  if (missingIds.length) {
    throw new Error(
      `Selected client ids were not found or are not enabled: ${missingIds.join(', ')}`
    )
  }

  return selectedClients
}

function selectClientsByUniqueNames(
  allClients: ClientAutomationData[],
  clientNames: string[]
): ClientAutomationData[] {
  const selectedClients: ClientAutomationData[] = []

  for (const clientName of clientNames) {
    const matches = allClients.filter(client => client.clientName === clientName)

    if (!matches.length) {
      throw new Error(
        `Selected clients were not found or are not enabled: ${clientName}`
      )
    }

    if (matches.length > 1) {
      throw new Error(
        `Client name "${clientName}" is ambiguous. Matching chat ids: ${matches
          .map(client => client.commonChatId)
          .join(', ')}`
      )
    }

    selectedClients.push(matches[0])
  }

  return selectedClients
}

async function runClientsOrchestrator(
  clients: ClientAutomationData[]
): Promise<OrchestratorStatus[]> {
  await assertDolphinAppRunning()
  await assertPreexistingDolphinProfileLimit()

  if (!clients.length) {
    throw new Error('No enabled client market targets were found')
  }

  console.log(
    `Starting ${clients.length} clients with ${CLIENT_START_DELAY_MS}ms stagger: ${clients
      .map(
        client =>
          `${client.clientName}/${client.commonChatId}/${client.market}(${client.dolphinProfileId})`
      )
      .join(', ')}`
  )
  console.log(
    `Recommended external timeout: ${getRecommendedExternalTimeoutMs(clients.length)}ms ` +
      `(formula: (watchMs + staggerMs + ${EXTERNAL_TIMEOUT_PROFILE_BUFFER_MS}ms * profiles) * ${EXTERNAL_TIMEOUT_MULTIPLIER})`
  )
  writeLocalRunLog({
    kind: 'run-start',
    localRunLogFile: LOCAL_RUN_LOG_FILE,
    market: ORCHESTRATOR_WORK_WITH_MARKET,
    watchMs: AUTO_RESPONDER_WATCH_MS,
    clientStartDelayMs: CLIENT_START_DELAY_MS,
    recommendedExternalTimeoutMs: getRecommendedExternalTimeoutMs(
      clients.length
    ),
    clients: clients.map(client => ({
      clientName: client.clientName,
      commonChatId: client.commonChatId,
      market: client.market,
      stack: client.stack,
      dolphinProfileId: client.dolphinProfileId
    }))
  })

  const results = await Promise.all(
    clients.map(async (client, index) => {
      const delayMs = index * CLIENT_START_DELAY_MS

      if (delayMs > 0) {
        console.log(
          `Waiting ${delayMs}ms before starting ${client.clientName}/${client.market}(${client.dolphinProfileId})`
        )
        await wait(delayMs)
      }

      return runClientOrchestrator(client)
    })
  )

  console.log(results)
  writeLocalRunLog({
    kind: 'run-results',
    results
  })
  await sendRunSummaryLog(results)

  return results
}

async function runSelectedClientsOrchestrator(
  clientNames: string[]
): Promise<OrchestratorStatus[]> {
  const repository = await createClientAutomationRepository()
  const allClients: ClientAutomationData[] =
    repository.getAllAutomationTargets(getConfiguredAutomationTargetOptions())
  const selectedClients = attachHHAuthCredentials(
    selectClientsByUniqueNames(allClients, clientNames),
    repository
  )

  return runClientsOrchestrator(selectedClients)
}

async function runSelectedClientIdsOrchestrator(
  clientIds: string[]
): Promise<OrchestratorStatus[]> {
  const repository = await createClientAutomationRepository()
  const allClients: ClientAutomationData[] =
    repository.getAllAutomationTargets(getConfiguredAutomationTargetOptions())
  const selectedClients = attachHHAuthCredentials(
    selectClientsByCommonChatIds(allClients, clientIds),
    repository
  )

  return runClientsOrchestrator(selectedClients)
}

async function runAllClientsOrchestrator(): Promise<OrchestratorStatus[]> {
  const repository = await createClientAutomationRepository()
  const clients: ClientAutomationData[] = attachHHAuthCredentials(
    repository.getAllAutomationTargets(getConfiguredAutomationTargetOptions()),
    repository
  )

  return runClientsOrchestrator(clients)
}

async function runConfiguredOrchestrator(): Promise<OrchestratorStatus[]> {
  const clientIds = getConfiguredClientIds()
  const clientNames = getConfiguredClientNames()

  if (clientIds.length) {
    if (clientNames.length) {
      console.warn(
        'ORCHESTRATOR_CLIENT_IDS is set; ignoring ORCHESTRATOR_CLIENT_NAMES.'
      )
    }

    return runSelectedClientIdsOrchestrator(clientIds)
  }

  if (clientNames.length) {
    return runSelectedClientsOrchestrator(clientNames)
  }

  return runAllClientsOrchestrator()
}

async function stopStartedProfiles(): Promise<void> {
  const profileIds = [...startedProfileIds]

  if (!profileIds.length) {
    return
  }

  await Promise.all(
    profileIds.map(async profileId => {
      try {
        await stopDolphinProfile(profileId)
      } catch (error: unknown) {
        console.error(
          `Failed to stop Dolphin profile ${profileId}: ${getErrorMessage(error)}`
        )
      }
    })
  )
}

function installProcessShutdownCleanup(): void {
  let cleanupStarted = false
  const cleanupAndExit = async (signal: string) => {
    if (cleanupStarted) {
      return
    }

    cleanupStarted = true
    console.error(
      `Received ${signal}; stopping started Dolphin profiles before exit`
    )
    writeLocalRunLog({
      kind: 'process-signal',
      signal,
      startedProfileIds: [...startedProfileIds]
    })
    await stopStartedProfiles()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }

  process.once('SIGINT', () => {
    cleanupAndExit('SIGINT').catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : error)
      process.exit(130)
    })
  })
  process.once('SIGTERM', () => {
    cleanupAndExit('SIGTERM').catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : error)
      process.exit(143)
    })
  })
}

if (require.main === module) {
  installProcessShutdownCleanup()

  runConfiguredOrchestrator()
    .then(() => process.exit(0))
    .catch(async (error: unknown) => {
      console.error(error instanceof Error ? error.stack : error)
      writeLocalRunLog({
        kind: 'run-fatal-error',
        error: getErrorMessage(error),
        errorStack: getErrorStack(error)
      })
      await sendRunErrorLog(error)
      process.exit(1)
    })
}

module.exports = {
  assertDolphinAppRunning,
  assertPreexistingDolphinProfileLimit,
  getLocalRunLogFile: () => LOCAL_RUN_LOG_FILE,
  getRecommendedExternalTimeoutMs,
  getRunningDolphinBrowserProfileIds,
  openScenarioAndInjectIndex,
  runAllClientsOrchestrator,
  runClientOrchestrator,
  runConfiguredOrchestrator,
  isClientReportSuccessful,
  runKiraOrchestrator,
  selectClientsByCommonChatIds,
  selectClientsByUniqueNames,
  splitTelegramMessage
}
