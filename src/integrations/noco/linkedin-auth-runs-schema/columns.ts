const LINKEDIN_AUTH_RUN_COLUMNS = [
  { title: 'run_id', column_name: 'run_id', uidt: 'SingleLineText', pv: true },
  { title: 'platform_account_id', column_name: 'platform_account_id', uidt: 'Number' },
  { title: 'client_name', column_name: 'client_name', uidt: 'SingleLineText' },
  { title: 'action', column_name: 'action', uidt: 'SingleLineText' },
  { title: 'status', column_name: 'status', uidt: 'SingleLineText' },
  { title: 'stage', column_name: 'stage', uidt: 'SingleLineText' },
  { title: 'error_code', column_name: 'error_code', uidt: 'SingleLineText' },
  { title: 'started_at', column_name: 'started_at', uidt: 'DateTime' },
  { title: 'finished_at', column_name: 'finished_at', uidt: 'DateTime' }
] as const

module.exports = { LINKEDIN_AUTH_RUN_COLUMNS }
