const { sendTelegramMessage } = require('../messenger.ts')
const { splitTelegramMessage } = require('./reports.ts')
const {
  AUTH_CHECK_PARSER_ERROR_CODES,
  LOGS_CHANNEL_ID,
  SUMMARY_LOGS_CHANNEL_ID,
  TELEGRAM_MESSAGE_LIMIT
} = require('./config.ts')
const { writeLocalRunLog } = require('./local-run-log.ts')
const { getErrorMessage, getErrorStack } = require('./runtime-utils.ts')
const {
  classifyClientRun,
  isClientRunSuccessful,
  isStopReasonNormal
} = require('./scraper-state.ts')

type HhAuthCheck = import('./types.ts').HhAuthCheck
type LifecycleEvent = import('./types.ts').LifecycleEvent
type ManualVacanciesCleanupResult =
  import('./types.ts').ManualVacanciesCleanupResult
type ManualVacancy = import('./types.ts').ManualVacancy
type OrchestratorStatus = import('./types.ts').OrchestratorStatus
type ParserLogEntry = import('./types.ts').ParserLogEntry

const CAPTCHA_REPAIR_MENTION = '@kiraSamsonova нужно починить капчу'

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 20)}\n...truncated`
}

function formatStatusFlag(label: string, value: unknown): string {
  return `${label}: ${value === undefined ? 'n/a' : String(value)}`
}

function truncateTelegramLine(value: string, maxLength = 350): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 3)}...`
}

function escapeTelegramHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function getTelegramLinkLabel(parsedUrl: URL): string {
  const vacancyMatch = parsedUrl.pathname.match(/\/vacancy\/(\d+)/)

  if (vacancyMatch) {
    return vacancyMatch[1]
  }

  return parsedUrl.hostname
}

function formatTelegramLink(url: string | undefined, label?: string): string {
  if (!url) {
    return 'n/a'
  }

  try {
    const parsedUrl = new URL(url)
    const linkLabel = label ?? getTelegramLinkLabel(parsedUrl)

    return `<a href="${escapeTelegramHtml(url)}">${escapeTelegramHtml(linkLabel)}</a>`
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
    `kept ${result.keptCount}`,
    result.error ? `error ${result.error}` : undefined
  ]
    .filter(Boolean)
    .join(', ')
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
  return isStopReasonNormal(status)
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
      : undefined,
    classifyClientRun(status) === 'captcha_detected'
      ? escapeTelegramHtml(CAPTCHA_REPAIR_MENTION)
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
  const classification = classifyClientRun(status)

  if (classification === 'captcha_detected') {
    return `обнаружена капча; ${CAPTCHA_REPAIR_MENTION}`
  }

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

  if (classification === 'auth_required') {
    return 'HH запросил авторизацию'
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

function formatCaptchaProfilesSummary(
  results: OrchestratorStatus[]
): string | undefined {
  const captchaProfiles = results
    .filter(status => classifyClientRun(status) === 'captcha_detected')
    .map(status => `${status.clientName}${status.market ? ` / ${status.market}` : ''}`)

  if (captchaProfiles.length === 0) {
    return undefined
  }

  return [
    `captcha found for profiles ${captchaProfiles
      .map(escapeTelegramHtml)
      .join(', ')}`,
    escapeTelegramHtml(CAPTCHA_REPAIR_MENTION)
  ].join('\n')
}

function formatRunSummaryLog(results: OrchestratorStatus[]): string {
  const successful = results.filter(status => !hasClientFailure(status))
  const failed = results.filter(hasClientFailure)
  const captchaSummary = formatCaptchaProfilesSummary(results)
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
      captchaSummary,
      `Откликов всего: ${responseCount}`,
      `Ручных вакансий всего: ${manualCount}`,
      '',
      ...rows
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n'),
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
  return !isClientRunSuccessful(status)
}

function isClientReportSuccessful(status: OrchestratorStatus): boolean {
  return isClientRunSuccessful(status)
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
    `Вакансий для ручного отклика: ${vacancies.length}. Пожалуйста, откликнись мануально _со всех резюме_ как можно скорее!`,
    manualVacanciesCleanupLine
      ? escapeTelegramHtml(manualVacanciesCleanupLine)
      : undefined,
    ''
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

module.exports = {
  addLifecycleEvent,
  formatCaptchaProfilesSummary,
  formatRunSummaryLog,
  formatAuthCheckBrief,
  formatManualVacanciesCleanupBrief,
  hasClientFailure,
  isAutoResponderStopNormal,
  isClientReportSuccessful,
  sendClientErrorLog,
  sendClientLifecycleLog,
  sendManualVacanciesToTelegram,
  sendParserLogsToTelegram,
  sendRunErrorLog,
  sendRunSummaryLog,
  shouldCheckAuthAfterParserStop,
  shouldSendParserLogsToTelegram,
  writeLocalRunLog
}
