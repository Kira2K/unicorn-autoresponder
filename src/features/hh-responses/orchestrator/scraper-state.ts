type AutoResponderStopReason =
  import('./types.ts').AutoResponderStopReason
type ClientRunClassification =
  import('./types.ts').ClientRunClassification
type KnownAutoResponderStopReason =
  import('./types.ts').KnownAutoResponderStopReason
type KnownParserErrorCode = import('./types.ts').KnownParserErrorCode
type ManualVacancy = import('./types.ts').ManualVacancy
type ManualBlockerSummary = import('./types.ts').ManualBlockerSummary
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
  'orchestrator_idle_timeout',
  'hh_response_daily_limit_exceeded',
  'vacancy_processing_error',
  'vacancy_recovery_limit_exceeded',
  'auth_required',
  'captcha_detected',
  'selector_missing',
  'network_timeout',
  'resume_loop_detected'
])

const KNOWN_PARSER_CODES = new Set<KnownParserErrorCode>([
  'AUTH_REQUIRED',
  'COMPANY_STOP_LIST_SKIPPED',
  'SKIPPED_COMPANY_STOP_LIST',
  'ERROR_NO_MODAL',
  'STUCK_ON_VACANCY_TIMEOUT',
  'RECOVERABLE_VACANCY_SKIPPED',
  'RESUME_LOOP_DETECTED',
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

function normalizePositiveInteger(value: unknown): number | undefined {
  const numberValue = Number(value)

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return undefined
  }

  return Math.floor(numberValue)
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

function extractManualChecksFromDetails(
  details: string | undefined
): Record<string, boolean> | undefined {
  if (!details) {
    return undefined
  }

  const match = details.match(/checks=(\{.*\})/)
  if (!match) {
    return undefined
  }

  try {
    const parsed = JSON.parse(match[1])
    if (!isObject(parsed)) {
      return undefined
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
    )
  } catch {
    return undefined
  }
}

function getTopManualBlockers(
  checks: Record<string, boolean> | undefined
): string[] {
  if (!checks) {
    return []
  }

  const preferredOrder = [
    'manualResponsePage',
    'questionForm',
    'textarea',
    'resumeVisibility',
    'additionalResumeApply',
    'dailyLimit',
    'authRequired',
    'alreadyResponded',
    'submit'
  ]
  const active = new Set(
    Object.entries(checks)
      .filter(([, value]) => value)
      .map(([key]) => key)
  )

  return [
    ...preferredOrder.filter(key => active.has(key)),
    ...[...active].filter(key => !preferredOrder.includes(key))
  ]
}

function summarizeManualBlockers(input: {
  manualVacancies?: ManualVacancy[]
  manualVacanciesCount?: number
  stopReasonDetails?: string
}): ManualBlockerSummary | undefined {
  const manualVacancies = input.manualVacancies ?? []
  const manualCount = input.manualVacanciesCount ?? manualVacancies.length
  const checks = extractManualChecksFromDetails(input.stopReasonDetails)
  const topBlockers = getTopManualBlockers(checks)

  if (!manualCount && !topBlockers.length) {
    return undefined
  }

  return {
    manualCount,
    ...(manualVacancies[0] ? { firstManualVacancy: manualVacancies[0] } : {}),
    ...(checks ? { checks } : {}),
    topBlockers
  }
}

function evaluateResponseRequirement(status: OrchestratorStatus): {
  requiredResponseLimit?: number
  metResponseLimit?: boolean
  completionGap?: string
  responsesRemaining?: number
} {
  const requiredResponseLimit = normalizePositiveInteger(
    status.requiredResponseLimit
  )
  const responseCount = Math.max(0, Number(status.responseCount ?? 0))

  if (!requiredResponseLimit) {
    return {
      metResponseLimit: false,
      completionGap: 'response_limit_unknown'
    }
  }

  const responsesRemaining = Math.max(requiredResponseLimit - responseCount, 0)
  const metResponseLimit =
    status.autoResponderStopReason === 'limit_reached' &&
    responseCount >= requiredResponseLimit

  if (metResponseLimit) {
    return {
      requiredResponseLimit,
      metResponseLimit,
      completionGap: 'met_response_limit',
      responsesRemaining
    }
  }

  if (status.error) {
    return {
      requiredResponseLimit,
      metResponseLimit: false,
      completionGap: `error_before_requirement:${status.error}`,
      responsesRemaining
    }
  }

  if (
    status.autoResponderStopReason === 'manual_targets_only' ||
    status.autoResponderStopReason === 'no_new_targets' ||
    status.autoResponderStopReason === 'orchestrator_stop_after_watch' ||
    status.autoResponderStopReason === 'orchestrator_idle_timeout'
  ) {
    return {
      requiredResponseLimit,
      metResponseLimit: false,
      completionGap: `${status.autoResponderStopReason}:missing_${responsesRemaining}_responses`,
      responsesRemaining
    }
  }

  return {
    requiredResponseLimit,
    metResponseLimit: false,
    completionGap: status.autoResponderStopReason
      ? `${status.autoResponderStopReason}:requirement_not_proven`
      : 'no_terminal_stop_reason',
    responsesRemaining
  }
}

function applyResponseRequirementStatus(
  status: OrchestratorStatus
): OrchestratorStatus {
  return {
    ...status,
    ...evaluateResponseRequirement(status)
  }
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

  const reason = stopReason.reason

  return {
    kind: KNOWN_STOP_REASONS.has(reason as KnownAutoResponderStopReason)
      ? 'known_stop_reason'
      : 'unknown_stop_reason',
    ...stopReason,
    reason
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

  const errorText = [status.error, status.errorStack]
    .filter(Boolean)
    .join('\n')

  if (/captcha|капч/i.test(errorText)) {
    return 'captcha_detected'
  }

  if (
    /auth validation failed|auth required|logged_out/i.test(errorText) ||
    status.authBeforeStart?.state === 'logged_out'
  ) {
    return 'auth_required'
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

  if (stopReason === 'orchestrator_idle_timeout') {
    return 'scraper_error'
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
  applyResponseRequirementStatus,
  evaluateResponseRequirement,
  normalizeParserErrorCode,
  normalizeParserErrors,
  normalizeParserLogs,
  normalizeRecentUrls,
  normalizeStopReason,
  normalizeStopReasonValue,
  summarizeManualBlockers
}
