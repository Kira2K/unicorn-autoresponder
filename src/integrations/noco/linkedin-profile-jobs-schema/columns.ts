export const LINKEDIN_PROFILE_JOB_COLUMNS = [
  { title: 'job_id', column_name: 'job_id', uidt: 'SingleLineText', pv: true },
  { title: 'platform_account_id', column_name: 'platform_account_id', uidt: 'Number' },
  { title: 'unipile_account_id', column_name: 'unipile_account_id', uidt: 'SingleLineText' },
  { title: 'client_name', column_name: 'client_name', uidt: 'SingleLineText' },
  { title: 'status', column_name: 'status', uidt: 'SingleLineText' },
  { title: 'phase', column_name: 'phase', uidt: 'SingleLineText' },
  { title: 'plan_hash', column_name: 'plan_hash', uidt: 'SingleLineText' },
  { title: 'plan_json', column_name: 'plan_json', uidt: 'LongText' },
  { title: 'result_json', column_name: 'result_json', uidt: 'LongText' },
  { title: 'error_code', column_name: 'error_code', uidt: 'SingleLineText' },
  { title: 'created_at', column_name: 'created_at', uidt: 'DateTime' },
  { title: 'updated_at', column_name: 'updated_at', uidt: 'DateTime' },
  { title: 'finished_at', column_name: 'finished_at', uidt: 'DateTime' }
] as const
