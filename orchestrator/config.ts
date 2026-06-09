const path = require('node:path')
require('dotenv').config({ quiet: true })

const { HH_AUTO_RESPONDER_STORAGE_KEYS } = require('../shared/hh-storage.ts')

function parseBooleanEnv(
  value: string | undefined,
  fallback: boolean
): boolean {
  if (value === undefined) {
    return fallback
  }

  return ['1', 'true', 'yes', 'да', 'y'].includes(value.trim().toLowerCase())
}

function parseMarketEnv(value: string | undefined): 'Ru' | 'En' {
  const normalized = String(value ?? 'ru')
    .trim()
    .toLowerCase()

  if (!normalized || normalized === 'ru') {
    return 'Ru'
  }

  if (normalized === 'en') {
    return 'En'
  }

  throw new Error(
    `Invalid ORCHESTRATOR_WORK_WITH_MARKET value "${value}". Expected "ru", "en", or no value.`
  )
}

const DEFAULT_WATCH_MS = 15 * 60 * 1000
const AUTO_RESPONDER_WATCH_MS = Number(
  process.env.ORCHESTRATOR_WATCH_MS ?? DEFAULT_WATCH_MS
)
const DEFAULT_ORCHESTRATOR_RESPONSE_LIMIT = 180
const ORCHESTRATOR_RESPONSE_LIMIT =
  process.env.ORCHESTRATOR_RESPONSE_LIMIT === undefined ||
  String(process.env.ORCHESTRATOR_RESPONSE_LIMIT).trim() === ''
    ? DEFAULT_ORCHESTRATOR_RESPONSE_LIMIT
    : Number(process.env.ORCHESTRATOR_RESPONSE_LIMIT)
const DEFAULT_CLIENT_START_DELAY_MS = 20 * 1000
const CLIENT_START_DELAY_MS = Number(
  process.env.ORCHESTRATOR_START_DELAY_MS ?? DEFAULT_CLIENT_START_DELAY_MS
)
const EXTERNAL_TIMEOUT_PROFILE_BUFFER_MS = 60 * 1000
const EXTERNAL_TIMEOUT_MULTIPLIER = 1.1
const LOCAL_RUN_ID = new Date().toISOString().replace(/[:.]/g, '-')
const LOCAL_RUN_LOG_DIR = path.resolve(__dirname, '..', 'logs')

module.exports = {
  AUTOMATION_LOCK_STATUS_COLOR: 'orange',
  AUTOMATION_LOCK_STATUS_NAME: 'Автоотклики, не трогай',
  AUTOMATION_LOCK_TAG: 'Автоотклики, не трогай',
  AUTO_RESPONDER_WATCH_MS,
  AUTH_CHECK_PARSER_ERROR_CODES: new Set([
    'AUTH_REQUIRED',
    'auth_required',
    'ERROR_NO_MODAL'
  ]),
  CLIENT_START_DELAY_MS,
  CONNECT_OVER_CDP_TIMEOUT_MS: 60000,
  DEFAULT_CLIENT_START_DELAY_MS,
  DEFAULT_ORCHESTRATOR_RESPONSE_LIMIT,
  DEFAULT_WATCH_MS,
  DOLPHIN_HEADLESS: parseBooleanEnv(process.env.DOLPHIN_HEADLESS, true),
  DOLPHIN_LOCAL_API_BASE_URL: 'http://localhost:3001/v1.0',
  DOLPHIN_LOCAL_API_HEALTH_TIMEOUT_MS: 5000,
  DOLPHIN_PROFILE_START_RETRY_BASE_MS: Number(
    process.env.DOLPHIN_PROFILE_START_RETRY_BASE_MS ?? 5000
  ),
  DOLPHIN_PROFILE_START_MAX_ATTEMPTS: Number(
    process.env.DOLPHIN_PROFILE_START_MAX_ATTEMPTS ?? 8
  ),
  EXTERNAL_TIMEOUT_MULTIPLIER,
  EXTERNAL_TIMEOUT_PROFILE_BUFFER_MS,
  HH_AUTH_DEBUG: parseBooleanEnv(process.env.HH_AUTH_DEBUG, false),
  HH_AUTH_TIMEOUT_MS: Number(process.env.HH_AUTH_TIMEOUT_MS ?? 30000),
  HH_AUTH_TOTAL_TIMEOUT_MS: Number(
    process.env.HH_AUTH_TOTAL_TIMEOUT_MS ?? 4 * 60 * 1000
  ),
  HH_SCENARIO_AUTH_UNKNOWN_RECHECK_INTERVAL_MS: Number(
    process.env.HH_SCENARIO_AUTH_UNKNOWN_RECHECK_INTERVAL_MS ?? 3000
  ),
  HH_SCENARIO_AUTH_UNKNOWN_RECHECK_MS: Number(
    process.env.HH_SCENARIO_AUTH_UNKNOWN_RECHECK_MS ?? 45000
  ),
  HH_AUTO_RESPONDER_LOGS_KEY: HH_AUTO_RESPONDER_STORAGE_KEYS.logs,
  HH_AUTO_RESPONDER_MANUAL_LIST_KEY: HH_AUTO_RESPONDER_STORAGE_KEYS.manualList,
  HH_AUTO_RESPONDER_PARSER_ERRORS_KEY:
    HH_AUTO_RESPONDER_STORAGE_KEYS.parserErrors,
  HH_AUTO_RESPONDER_RECENT_URLS_KEY: HH_AUTO_RESPONDER_STORAGE_KEYS.recentUrls,
  HH_AUTO_RESPONDER_RUNNING_KEY: HH_AUTO_RESPONDER_STORAGE_KEYS.isRunning,
  HH_AUTO_RESPONDER_SETTINGS_KEY: HH_AUTO_RESPONDER_STORAGE_KEYS.settings,
  HH_AUTO_RESPONDER_STOP_REASON_KEY: HH_AUTO_RESPONDER_STORAGE_KEYS.stopReason,
  HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSE_IDS_KEY:
    HH_AUTO_RESPONDER_STORAGE_KEYS.successfulResponseIds,
  HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSES_KEY:
    HH_AUTO_RESPONDER_STORAGE_KEYS.successfulResponses,
  HH_INITIAL_NAVIGATION_TIMEOUT_MS: 250000,
  INDEX_SCRIPT_PATH: path.resolve(__dirname, '..', 'index.js'),
  LOCAL_RUN_ID,
  LOCAL_RUN_LOG_DIR,
  LOCAL_RUN_LOG_FILE: path.join(
    LOCAL_RUN_LOG_DIR,
    `orchestrator-run-${LOCAL_RUN_ID}-${process.pid}.jsonl`
  ),
  LOGS_CHANNEL_ID: process.env.logs_channel_id?.trim(),
  MAX_PREEXISTING_DOLPHIN_PROFILES: Number(
    process.env.MAX_PREEXISTING_DOLPHIN_PROFILES ?? 3
  ),
  NORMAL_AUTO_RESPONDER_STOP_REASONS: new Set([
    'targets_processed',
    'no_new_targets',
    'limit_reached',
    'manual_targets_only',
    'hh_response_daily_limit_exceeded',
    'user_stop'
  ]),
  SUMMARY_LOGS_CHANNEL_ID: process.env.summary_logs_channel_id?.trim(),
  TELEGRAM_MESSAGE_LIMIT: 3900,
  ORCHESTRATOR_WORK_WITH_MARKET: parseMarketEnv(
    process.env.ORCHESTRATOR_WORK_WITH_MARKET
  ),
  ORCHESTRATOR_RESPONSE_LIMIT,
  parseBooleanEnv,
  parseMarketEnv
}
