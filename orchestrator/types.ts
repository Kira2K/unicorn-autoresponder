export type ClientAutomationData = {
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

export type ClientHHAuthCredentials = {
  clientName: string
  market?: 'Ru' | 'En'
  phone: string
  rawPhone: string
  password: string
  email: string
  emailPassword?: string
}

export type AutomationTargetOptions = {
  workWithRuOnly?: boolean
  market?: 'Ru' | 'En'
}

export type OrchestratorStatus = {
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

export type ManualVacanciesCleanupResult = {
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
  reason?: string
  details?: string
  ts?: number
  url?: string
  recentUrls?: RecentUrlEntry[]
}

export type ParserErrorEntry = {
  code?: string
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
