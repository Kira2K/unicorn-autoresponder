export const LINKEDIN_COMMENT_MONITOR_COLUMNS = [
  { title: 'job_id', column_name: 'job_id', uidt: 'SingleLineText', pv: true },
  { title: 'platform_account_id', column_name: 'platform_account_id', uidt: 'Number' },
  { title: 'unipile_account_id', column_name: 'unipile_account_id', uidt: 'SingleLineText' },
  { title: 'client_name', column_name: 'client_name', uidt: 'SingleLineText' },
  { title: 'status', column_name: 'status', uidt: 'SingleLineText' },
  { title: 'stage', column_name: 'stage', uidt: 'SingleLineText' },
  { title: 'state_json', column_name: 'state_json', uidt: 'LongText' },
  { title: 'next_check_at', column_name: 'next_check_at', uidt: 'DateTime' },
  { title: 'last_check_at', column_name: 'last_check_at', uidt: 'DateTime' },
  { title: 'expires_at', column_name: 'expires_at', uidt: 'DateTime' },
  { title: 'error_code', column_name: 'error_code', uidt: 'SingleLineText' },
  { title: 'created_at', column_name: 'created_at', uidt: 'DateTime' },
  { title: 'updated_at', column_name: 'updated_at', uidt: 'DateTime' },
  { title: 'finished_at', column_name: 'finished_at', uidt: 'DateTime' }
] as const
