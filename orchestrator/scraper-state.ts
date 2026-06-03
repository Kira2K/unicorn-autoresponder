type AutoResponderStopReason =
  import('./types.ts').AutoResponderStopReason
type ClientRunClassification =
  import('./types.ts').ClientRunClassification
type KnownAutoResponderStopReason =
  import('./types.ts').KnownAutoResponderStopReason
type KnownParserErrorCode = import('./types.ts').KnownParserErrorCode
type ManualVacancy = import('./types.ts').ManualVacancy
type NormalizedAutoResponderStopReason =
  import('./types.ts').NormalizedAutoResponderStopReason
type NormalizedParserErrorCode =
  import('./types.ts').NormalizedParserErrorCode
type OrchestratorStatus = import('./types.ts').OrchestratorStatus
type ParserErrorEntry = import('./types.ts').ParserErrorEntry
type ParserLogEntry = import('./types.ts').ParserLogEntry
type RecentUrlEntry = import('./types.ts').RecentUrlEntry

const KNOWN_STOP_REASONS = new Set<KnownAutoResponderStopReason>([
  'targets_processed',
  'no_new_targets',
  'limit_reached',
  'manual_targets_only',
  'user_stop',
  'orchestrator_stop_after_watch',
  'hh_response_daily_limit_exceeded',
  'vacancy_processing_error',
  'auth_required',
  'captcha_detected',
  'selector_missing',
  'network_timeout'
])

const KNOWN_PARSER_CODES = new Set<KnownParserErrorCode>([
  'AUTH_REQUIRED',
  'COMPANY_STOP_LIST_SKIPPED',
  'SKIPPED_COMPANY_STOP_LIST',
  'ERROR_NO_MODAL',
  'STUCK_ON_VACANCY_TIMEOUT',
  'selector_missing',
  'captcha_detected',
  'network_timeout'
])

const NORMAL_STOP_REASONS = new Set<KnownAutoResponderStopReason>([
  'targets_processed',
  'no_new_targets',
  'limit_reached',
  'manual_targets_only',
  'hh_response_daily_limit_exceeded',
  'user_stop'
])

const BENIGN_PARSER_CODES = new Set([
  'COMPANY_STOP_LIST_SKIPPED',
  'SKIPPED_COMPANY_STOP_LIST'
])

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) ? numberValue : undefined
}

function normalizeRecentUrlEntry(value: unknown): RecentUrlEntry | undefined {
  if (!isObject(value)) {
    return undefined
  }

  const url = normalizeOptionalString(value.url)
  const title = normalizeOptionalString(value.title)
  const reason = normalizeOptionalString(value.reason)
  const ts = normalizeOptionalNumber(value.ts)

  if (!url && !title && !reason && ts === undefined) {
    return undefined
  }

  return {
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    ...(reason ? { reason } : {}),
    ...(ts !== undefined ? { ts } : {})
  }
}

function normalizeRecentUrls(value: unknown): RecentUrlEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(normalizeRecentUrlEntry)
    .filter((entry): entry is RecentUrlEntry => Boolean(entry))
}

function normalizeManualVacancy(value: unknown): ManualVacancy | undefined {
  if (!isObject(value)) {
    return undefined
  }

  const url = normalizeOptionalString(value.url)
  const vid = normalizeOptionalString(value.vid)
  const returnUrl = normalizeOptionalString(value.returnUrl)
  const title = normalizeOptionalString(value.title)
  const ts = normalizeOptionalNumber(value.ts)

  if (!url && !vid) {
    return undefined
  }

  return {
    ...(vid ? { vid } : {}),
    ...(url ? { url } : {}),
    ...(returnUrl ? { returnUrl } : {}),
    ...(ts !== undefined ? { ts } : {}),
    ...(title ? { title } : {})
  }
}

function normalizeManualVacancies(value: unknown): ManualVacancy[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(normalizeManualVacancy)
    .filter((item): item is ManualVacancy => Boolean(item))
}

function normalizeParserLogEntry(value: unknown): ParserLogEntry | undefined {
  if (!isObject(value)) {
    return undefined
  }

  const message = normalizeOptionalString(value.message)
  const time = normalizeOptionalString(value.time)
  const url = normalizeOptionalString(value.url)
  const ts = normalizeOptionalNumber(value.ts)
  const isError = typeof value.isError === 'boolean' ? value.isError : undefined

  if (!message && !time && !url && ts === undefined && isError === undefined) {
    return undefined
  }

  return {
    ...(ts !== undefined ? { ts } : {}),
    ...(time ? { time } : {}),
    ...(message ? { message } : {}),
    ...(isError !== undefined ? { isError } : {}),
    ...(url ? { url } : {})
  }
}

function normalizeParserLogs(value: unknown): ParserLogEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(normalizeParserLogEntry)
    .filter((entry): entry is ParserLogEntry => Boolean(entry))
}

function normalizeParserErrorEntry(
  value: unknown
): ParserErrorEntry | undefined {
  if (!isObject(value)) {
    return undefined
  }

  const code = normalizeOptionalString(value.code)
  const details = normalizeOptionalString(value.details)
  const url = normalizeOptionalString(value.url)
  const ts = normalizeOptionalNumber(value.ts)
  const recentUrls = normalizeRecentUrls(value.recentUrls)

  if (!code && !details && !url && ts === undefined && !recentUrls.length) {
    return undefined
  }

  return {
    ...(code ? { code } : {}),
    ...(details ? { details } : {}),
    ...(ts !== undefined ? { ts } : {}),
    ...(url ? { url } : {}),
    ...(recentUrls.length ? { recentUrls } : {})
  }
}

function normalizeParserErrors(value: unknown): ParserErrorEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(normalizeParserErrorEntry)
    .filter((entry): entry is ParserErrorEntry => Boolean(entry))
}

function normalizeStopReasonValue(
  value: unknown
): AutoResponderStopReason | undefined {
  if (typeof value === 'string') {
    const reason = value.trim()

    return reason ? { reason } : undefined
  }

  if (!isObject(value)) {
    return undefined
  }

  const reason = normalizeOptionalString(value.reason)
  const details = normalizeOptionalString(value.details)
  const url = normalizeOptionalString(value.url)
  const ts = normalizeOptionalNumber(value.ts)
  const recentUrls = normalizeRecentUrls(value.recentUrls)

  if (!reason && !details && !url && ts === undefined && !recentUrls.length) {
    return undefined
  }

  return {
    ...(reason ? { reason } : {}),
    ...(details ? { details } : {}),
    ...(ts !== undefined ? { ts } : {}),
    ...(url ? { url } : {}),
    ...(recentUrls.length ? { recentUrls } : {})
  }
}

function normalizeStopReason(
  value: unknown
): NormalizedAutoResponderStopReason | undefined {
  const stopReason = normalizeStopReasonValue(value)

  if (!stopReason?.reason) {
    return undefined
  }

  return {
    kind: KNOWN_STOP_REASONS.has(
      stopReason.reason as KnownAutoResponderStopReason
    )
      ? 'known_stop_reason'
      : 'unknown_stop_reason',
    ...stopReason
  }
}

function normalizeParserErrorCode(code: unknown): NormalizedParserErrorCode {
  const normalizedCode = normalizeOptionalString(code) ?? 'unknown'

  return {
    kind: KNOWN_PARSER_CODES.has(normalizedCode as KnownParserErrorCode)
      ? 'known_parser_code'
      : 'unknown_parser_code',
    code: normalizedCode
  }
}

function isStopReasonNormal(status: OrchestratorStatus): boolean {
  const blockingParserCodes = (status.parserErrorCodes ?? []).filter(
    code => !BENIGN_PARSER_CODES.has(code)
  )

  if (blockingParserCodes.length) {
    return false
  }

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
    NORMAL_STOP_REASONS.has(
      status.autoResponderStopReason as KnownAutoResponderStopReason
    )
  )
}

function classifyClientRun(status: OrchestratorStatus): ClientRunClassification {
  if (status.telegramError) {
    return 'telegram_error'
  }

  if (
    status.error?.includes('Browser CDP connection was closed') ||
    status.error?.includes('Page was closed while auto responder was running')
  ) {
    return 'browser_disconnected'
  }

  if (status.error) {
    return 'scraper_error'
  }

  if (!status.opened || !status.startButtonClicked) {
    return 'scraper_error'
  }

  const codes = new Set(status.parserErrorCodes ?? [])
  const stopReason = status.autoResponderStopReason
  const authStateAfterStop = status.authAfterParserStop?.state

  if (
    stopReason === 'captcha_detected' ||
    codes.has('captcha_detected') ||
    authStateAfterStop === 'captcha'
  ) {
    return 'captcha_detected'
  }

  if (
    stopReason === 'auth_required' ||
    codes.has('AUTH_REQUIRED') ||
    authStateAfterStop === 'logged_out'
  ) {
    return 'auth_required'
  }

  if (stopReason === 'orchestrator_stop_after_watch') {
    return isStopReasonNormal(status) ? 'normal_timeout' : 'scraper_error'
  }

  if (isStopReasonNormal(status)) {
    return 'success'
  }

  if (Number(status.manualVacanciesCount ?? 0) > 0) {
    return 'manual_required'
  }

  return 'scraper_error'
}

function isClientRunSuccessful(status: OrchestratorStatus): boolean {
  const classification = classifyClientRun(status)

  return classification === 'success' || classification === 'normal_timeout'
}

module.exports = {
  classifyClientRun,
  isClientRunSuccessful,
  isStopReasonNormal,
  normalizeManualVacancies,
  normalizeParserErrorCode,
  normalizeParserErrors,
  normalizeParserLogs,
  normalizeRecentUrls,
  normalizeStopReason,
  normalizeStopReasonValue
}
