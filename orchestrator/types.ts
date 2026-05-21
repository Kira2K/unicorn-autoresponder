export type Market = import('../db/types.ts').Market
export type DbClientAutomationData =
  import('../db/types.ts').ClientAutomationData
export type ClientHHAuthCredentials =
  import('../db/types.ts').ClientHHAuthCredentials
export type AutomationTargetOptions =
  import('../db/types.ts').AutomationTargetOptions
export type BlockedCompany = NonNullable<
  DbClientAutomationData['blockedCompanies']
>[number]

export type ClientAutomationData = DbClientAutomationData & {
  hhAuthCredentials?: ClientHHAuthCredentials
}

// Runtime-ready client. Build this only after validating stackScenario exists,
// so browser startup code never needs a non-null assertion.
export type RunnableClientAutomationData = ClientAutomationData & {
  stackScenario: string
}

// Structural Playwright page contract. Playwright is loaded dynamically, so keep
// this local boundary instead of importing Playwright types everywhere.
export type BrowserPageLike = {
  isClosed(): boolean
  url(): string
  title(): Promise<string>
  goto(
    url: string,
    options?: Record<string, unknown>
  ): Promise<unknown>
  waitForLoadState(
    state?: string,
    options?: Record<string, unknown>
  ): Promise<unknown>
  waitForSelector(
    selector: string,
    options?: Record<string, unknown>
  ): Promise<unknown>
  reload?(options?: Record<string, unknown>): Promise<unknown>
  evaluate<T = unknown, A = unknown>(
    pageFunction: unknown,
    arg?: A
  ): Promise<T>
  mainFrame?(): { url(): string }
  on?(eventName: string, handler: (...args: unknown[]) => void): void
  off?(eventName: string, handler: (...args: unknown[]) => void): void
  close?(): Promise<unknown>
}

export type KnownAutoResponderStopReason =
  | 'targets_processed'
  | 'no_new_targets'
  | 'limit_reached'
  | 'manual_targets_only'
  | 'user_stop'
  | 'orchestrator_stop_after_watch'
  | 'hh_response_daily_limit_exceeded'
  | 'vacancy_processing_error'
  | 'auth_required'
  | 'captcha_detected'
  | 'selector_missing'
  | 'network_timeout'

export type KnownParserErrorCode =
  | 'AUTH_REQUIRED'
  | 'COMPANY_STOP_LIST_SKIPPED'
  | 'SKIPPED_COMPANY_STOP_LIST'
  | 'ERROR_NO_MODAL'
  | 'selector_missing'
  | 'captcha_detected'
  | 'network_timeout'

export type NormalizedAutoResponderStopReason = {
  kind: 'known_stop_reason' | 'unknown_stop_reason'
  reason: KnownAutoResponderStopReason | string
  details?: string
  ts?: number
  url?: string
  recentUrls?: RecentUrlEntry[]
}

export type NormalizedParserErrorCode = {
  kind: 'known_parser_code' | 'unknown_parser_code'
  code: KnownParserErrorCode | string
}

export type ClientRunClassification =
  | 'success'
  | 'normal_timeout'
  | 'manual_required'
  | 'auth_required'
  | 'captcha_detected'
  | 'scraper_error'
  | 'telegram_error'
  | 'browser_disconnected'

export type OrchestratorStatus = {
  clientName: string
  stack: string
  market?: Market
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

export type ManualVacanciesCleanupResult = {
  skipped: boolean
  completed: boolean
  initialCount: number
  checkedCount: number
  removedCount: number
  remainingCount: number
  keptCount: number
  error?: string
  items: Array<{
    id: string
    url: string
    title?: string
    action: 'removed' | 'kept'
    reason: string
  }>
}

export type LifecycleEvent = {
  at: string
  elapsedMs: number
  event: string
  details?: string
}

export type ManualVacancy = {
  vid?: string
  url?: string
  returnUrl?: string
  ts?: number
  title?: string
}

export type ParserLogEntry = {
  ts?: number
  time?: string
  message?: string
  isError?: boolean
  url?: string
}

export type AutoResponderStopReason = {
  reason?: KnownAutoResponderStopReason | string
  details?: string
  ts?: number
  url?: string
  recentUrls?: RecentUrlEntry[]
}

export type ParserErrorEntry = {
  code?: KnownParserErrorCode | string
  details?: string
  ts?: number
  url?: string
  recentUrls?: RecentUrlEntry[]
}

export type RecentUrlEntry = {
  url?: string
  title?: string
  reason?: string
  ts?: number
}

export type HhAuthState =
  | 'logged_in'
  | 'logged_out'
  | 'captcha'
  | 'conflict'
  | 'unknown'

export type HhAuthSignal = {
  exists: boolean
  tag?: string
  dataQa?: string | null
  href?: string | null
  text?: string
}

export type HhAuthCheck = {
  state: HhAuthState
  checkedAt: string
  url: string
  title: string
  signals: Record<string, HhAuthSignal>
}

export type LocalRunLogRecord = Record<string, unknown>

export type ResponseCounter = {
  vacancyIds: Set<string>
}

export type OpenScenarioResult = {
  page: BrowserPageLike
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
