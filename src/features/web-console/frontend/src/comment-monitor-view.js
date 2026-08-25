const ACTIVE = new Set(['starting', 'waiting', 'checking', 'replying', 'paused'])
const LABELS = {
  starting: 'Starting', waiting: 'Waiting', checking: 'Checking', replying: 'Replying',
  paused: 'Needs attention', completed: 'Completed', disabled: 'Off', error: 'Error'
}
const ERRORS = {
  comment_monitor_auth_required: 'Verify or reconnect LinkedIn first.',
  comment_monitor_posts_missing: 'No LinkedIn posts were found.',
  comment_monitor_user_id_missing: 'Verify the LinkedIn owner again.',
  comment_reply_uncertain: 'The write result is unknown. Resume performs read-back only.',
  openai_api_key_missing: 'Configure the OpenAI comment API key.',
  openai_model_missing: 'Configure the OpenAI comment model.',
  openai_rate_limited: 'OpenAI is temporarily rate limited.',
  unipile_api_too_many_requests: 'Unipile is temporarily rate limited.'
}

export const monitorActive = job => Boolean(job && ACTIVE.has(job.status))
export const monitorLabel = job => job ? LABELS[job.status] || job.status : 'Off'
export const monitorError = code => code ? `${ERRORS[code] || 'Comment monitoring stopped.'} (${code})` : ''

export function durationUntil(value, now = Date.now()) {
  if (!value) return '—'
  const seconds = Math.max(0, Math.floor((Date.parse(value) - now) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${rest}s`
}

export function latestForAccount(jobs, platformAccountId) {
  return jobs.find(job => Number(job.platformAccountId) === Number(platformAccountId)) || null
}
