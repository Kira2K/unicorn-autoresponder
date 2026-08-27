const ERRORS = {
  profile_cv_not_ready: 'No confirmed final EN CV was found in NocoDB.',
  profile_cv_credentials_missing: 'Google Drive service account credentials are not configured.',
  profile_cv_url_invalid: 'The final EN CV link is invalid.',
  profile_cv_access_denied: 'The Google service account cannot read the final EN CV.',
  profile_cv_format_unsupported: 'The final EN CV must be a Google Doc, PDF or DOCX upload.',
  profile_cv_empty: 'The uploaded CV file is empty.',
  profile_cv_content_invalid: 'The uploaded file content does not match PDF or DOCX.',
  profile_cv_too_large: 'The final EN CV exceeds 20 MB.',
  profile_cv_download_failed: 'The final EN CV could not be downloaded.',
  profile_proxy_ip_missing: 'The Dolphin proxy does not expose a valid IP address.',
  profile_proxy_country_unavailable: 'The Dolphin proxy country could not be determined.',
  profile_proxy_country_disallowed: 'Generation is blocked for a Russian proxy country.',
  openai_api_key_missing: 'OpenAI API key is not configured.',
  openai_model_missing: 'OpenAI profile model is not configured.',
  openai_credentials_rejected: 'OpenAI credentials were rejected.',
  openai_rate_limited: 'OpenAI rate limit was reached. Retry later.',
  openai_timeout: 'OpenAI profile generation timed out.',
  openai_service_unavailable: 'OpenAI profile generation is unavailable.',
  openai_schema_invalid: 'The profile generation schema was rejected by OpenAI.',
  openai_request_invalid: 'OpenAI rejected the profile generation request.',
  openai_response_refused: 'OpenAI refused this generation request.',
  openai_response_incomplete: 'OpenAI did not complete the structured response.',
  openai_response_invalid: 'OpenAI returned an invalid structured response.',
  profile_generation_validation_failed: 'Generated data failed strict validation.',
  unipile_api_too_many_requests: 'Unipile temporarily limited catalog requests. Generation can resume without calling OpenAI again.',
  unipile_http_429: 'Unipile temporarily limited catalog requests. Generation can resume without calling OpenAI again.'
}

const STAGES = {
  queued: 'Queued', extracting_cv_facts: 'Extracting facts from final EN CV',
  generating_profile: 'Generating LinkedIn profile', validating_profile: 'Validating profile',
  resolving_job_titles: 'Matching Open to Work roles with LinkedIn',
  retrying_job_titles: 'Waiting to retry LinkedIn role matching',
  resuming_job_titles: 'Resuming LinkedIn role matching',
  waiting_unipile_retry: 'Waiting for manual resume',
  interrupted_retryable: 'Saved generation can be resumed',
  building_preview: 'Building LinkedIn preview', preview_ready: 'Ready for manual review'
}

export const generationErrorText = code => ERRORS[code]
export const profileStageText = stage => STAGES[stage] || stage
