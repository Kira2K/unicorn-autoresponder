export const CONNECTION_CATALOG_COLUMNS = [
  { title: 'source_key', column_name: 'source_key', uidt: 'SingleLineText', pv: true, unique: true },
  { title: 'audience', column_name: 'audience', uidt: 'SingleLineText' },
  { title: 'city', column_name: 'city', uidt: 'SingleLineText' },
  { title: 'keyword_template', column_name: 'keyword_template', uidt: 'SingleLineText' },
  { title: 'priority', column_name: 'priority', uidt: 'Number' },
  { title: 'enabled', column_name: 'enabled', uidt: 'Checkbox' }
] as const

export const CONNECTION_RUN_COLUMNS = [
  { title: 'run_key', column_name: 'run_key', uidt: 'SingleLineText', pv: true, unique: true },
  { title: 'run_id', column_name: 'run_id', uidt: 'SingleLineText', unique: true },
  { title: 'platform_account_id', column_name: 'platform_account_id', uidt: 'Number' },
  { title: 'client_id', column_name: 'client_id', uidt: 'Number' },
  { title: 'client_name', column_name: 'client_name', uidt: 'SingleLineText' },
  { title: 'unipile_account_id', column_name: 'unipile_account_id', uidt: 'SingleLineText' },
  { title: 'stack_id', column_name: 'stack_id', uidt: 'Number' },
  { title: 'stack', column_name: 'stack', uidt: 'SingleLineText' },
  { title: 'safe_recruiter_only', column_name: 'safe_recruiter_only', uidt: 'Checkbox' },
  { title: 'local_date', column_name: 'local_date', uidt: 'Date' },
  { title: 'week_key', column_name: 'week_key', uidt: 'SingleLineText' },
  { title: 'status', column_name: 'status', uidt: 'SingleLineText' },
  { title: 'stage', column_name: 'stage', uidt: 'SingleLineText' },
  { title: 'connection_count', column_name: 'connection_count', uidt: 'Number' },
  { title: 'weekly_limit', column_name: 'weekly_limit', uidt: 'Number' },
  { title: 'daily_quota', column_name: 'daily_quota', uidt: 'Number' },
  { title: 'audience_quota_json', column_name: 'audience_quota_json', uidt: 'LongText' },
  { title: 'counters_json', column_name: 'counters_json', uidt: 'LongText' },
  { title: 'used_search_keys_json', column_name: 'used_search_keys_json', uidt: 'LongText' },
  { title: 'error_code', column_name: 'error_code', uidt: 'SingleLineText' },
  { title: 'created_at', column_name: 'created_at', uidt: 'DateTime' },
  { title: 'updated_at', column_name: 'updated_at', uidt: 'DateTime' },
  { title: 'finished_at', column_name: 'finished_at', uidt: 'DateTime' }
] as const

export const CONNECTION_HISTORY_COLUMNS = [
  { title: 'history_key', column_name: 'history_key', uidt: 'SingleLineText', pv: true, unique: true },
  { title: 'run_id', column_name: 'run_id', uidt: 'SingleLineText' },
  { title: 'platform_account_id', column_name: 'platform_account_id', uidt: 'Number' },
  { title: 'unipile_account_id', column_name: 'unipile_account_id', uidt: 'SingleLineText' },
  { title: 'person_id', column_name: 'person_id', uidt: 'SingleLineText' },
  { title: 'audience', column_name: 'audience', uidt: 'SingleLineText' },
  { title: 'search_key', column_name: 'search_key', uidt: 'SingleLineText' },
  { title: 'name', column_name: 'name', uidt: 'SingleLineText' },
  { title: 'headline', column_name: 'headline', uidt: 'LongText' },
  { title: 'location', column_name: 'location', uidt: 'SingleLineText' },
  { title: 'profile_url', column_name: 'profile_url', uidt: 'SingleLineText' },
  { title: 'status', column_name: 'status', uidt: 'SingleLineText' },
  { title: 'reason_code', column_name: 'reason_code', uidt: 'SingleLineText' },
  { title: 'request_id', column_name: 'request_id', uidt: 'SingleLineText' },
  { title: 'discovered_at', column_name: 'discovered_at', uidt: 'DateTime' },
  { title: 'updated_at', column_name: 'updated_at', uidt: 'DateTime' },
  { title: 'sent_at', column_name: 'sent_at', uidt: 'DateTime' },
  { title: 'verified_at', column_name: 'verified_at', uidt: 'DateTime' }
] as const
