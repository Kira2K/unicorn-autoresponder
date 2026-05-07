const HH_AUTO_RESPONDER_STORAGE_PREFIX = 'hh_ar_v2_'

const HH_AUTO_RESPONDER_STORAGE_KEYS = {
  settings: `${HH_AUTO_RESPONDER_STORAGE_PREFIX}cfg_data`,
  isRunning: `${HH_AUTO_RESPONDER_STORAGE_PREFIX}is_active`,
  manualList: `${HH_AUTO_RESPONDER_STORAGE_PREFIX}manual_list`,
  successfulResponses: `${HH_AUTO_RESPONDER_STORAGE_PREFIX}successful_responses`,
  logs: `${HH_AUTO_RESPONDER_STORAGE_PREFIX}logs`,
  stopReason: `${HH_AUTO_RESPONDER_STORAGE_PREFIX}stop_reason`,
  parserErrors: `${HH_AUTO_RESPONDER_STORAGE_PREFIX}parser_errors`,
  recentUrls: `${HH_AUTO_RESPONDER_STORAGE_PREFIX}recent_urls`
}

module.exports = {
  HH_AUTO_RESPONDER_STORAGE_KEYS,
  HH_AUTO_RESPONDER_STORAGE_PREFIX
}
