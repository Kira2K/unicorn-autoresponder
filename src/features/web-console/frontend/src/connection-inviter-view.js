const LABELS = {
  running: 'Running', paused: 'Needs stack', succeeded: 'Completed', failed: 'Failed',
  partial: 'Partial', uncertain: 'Read-back required', stopped: 'Stopped'
}
export const latestConnectionRun = (runs, platformAccountId) => runs.find(run =>
  Number(run.platformAccountId) === Number(platformAccountId)) || null

export const connectionRunActive = run => run?.status === 'running'
export const connectionRunLabel = run => run?.stage === 'completed_shortfall' ? 'Target not reached' :
  run?.stage === 'paused_transient' ? 'Paused' :
  run?.stage === 'waiting_retry' ? 'Waiting — automatic retry' :
  run?.stage === 'resolving_uncertain' ? 'Resolving invitation result' :
  run?.stage === 'search_exhausted' ? 'Catalog exhausted' :
  run ? LABELS[run.status] || run.status : 'Not run today'
export const connectionPollDelay = hidden => hidden ? 15_000 : 5_000

export function connectionLocalDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric',
    month: '2-digit', day: '2-digit' }).formatToParts(now)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function connectionRunCanStart(run, hasStack = true, today = connectionLocalDate()) {
  if (!run || (run.localDate && run.localDate !== today)) return true
  if (run.status === 'running' || run.status === 'uncertain') return false
  if (!['succeeded', 'stopped'].includes(run.status)) return true
  const target = Number(hasStack ? run.dailyLimit : run.dailyQuota)
  return !target || Number(run.counters?.sent || 0) < target
}

export function connectionPauseFromError(error) {
  const code = String(error?.body?.error || '')
  if (![429, 503].includes(Number(error?.status)) && !code.startsWith('noco_')) return null
  return { code: code || 'noco_temporarily_unavailable',
    message: 'NocoDB is temporarily busy. Run today to resume.' }
}

export function connectionRunConfirmation(account, run, safeRecruiterOnly = false) {
  const sameDay = run?.localDate === connectionLocalDate()
  const target = Number(safeRecruiterOnly ? run?.dailyQuota : run?.dailyLimit)
  const remaining = sameDay && target ? Math.max(0, target - Number(run?.counters?.sent || 0)) : target
  const quota = remaining > 0 ? `up to ${remaining}` : 'the calculated daily quota of'
  const mode = safeRecruiterOnly ? 'recruiters only' : 'the planned 70/30 mix'
  return `LIVE LinkedIn action: send ${quota} real invitations for ${account.clientName} (${mode}). Continue?`
}

export const connectionStopConfirmation = account =>
  `Stop this connection run for ${account.clientName}? No new invitation will start after the current request/read-back.`

export function connectionQuotaLabel(run) {
  if (!run?.dailyLimit) return 'Daily quota not calculated'
  return `${run.connectionCount} connections · ${run.dailyLimit}/day · ${run.dailyQuota || 0} today`
}

export function connectionAudienceLabel(run) {
  const quota = run?.audienceQuota || {}
  return `${quota.recruiter || 0} recruiters · ${quota.technical || 0} technical`
}

export const connectionProgressPercent = (value, target) => target > 0
  ? Math.min(100, Math.round(Number(value || 0) * 100 / Number(target))) : 0

export function connectionCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [hours, minutes, rest].map(value => String(value).padStart(2, '0')).join(':')
}

export function connectionEta(run, now = Date.now()) {
  const sent = Number(run?.counters?.sent || 0); const target = Number(run?.dailyQuota || 0)
  const started = Date.parse(run?.createdAt || '')
  if (!sent || !target || !Number.isFinite(started) || target <= sent) return ''
  const milliseconds = (now - started) / sent * (target - sent)
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return ''
  return `Approx. ETA ${connectionCountdown(milliseconds)}`
}
