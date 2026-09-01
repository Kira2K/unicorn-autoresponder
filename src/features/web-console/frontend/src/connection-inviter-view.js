const LABELS = {
  running: 'Running', paused: 'Needs stack', succeeded: 'Completed', failed: 'Failed',
  partial: 'Partial', uncertain: 'Read-back required', stopped: 'Stopped'
}

export const latestConnectionRun = (runs, platformAccountId) => runs.find(run =>
  Number(run.platformAccountId) === Number(platformAccountId)) || null

export const connectionRunActive = (run, today = connectionLocalDate()) =>
  run?.status === 'running' && (!run.localDate || run.localDate === today)
export const connectionRunFromPreviousDay = (run, today = connectionLocalDate()) =>
  run?.status === 'running' && Boolean(run.localDate) && run.localDate !== today
export const connectionRunLabel = (run, today = connectionLocalDate()) =>
  connectionRunFromPreviousDay(run, today) ? 'Partial - day closed' :
  run?.stage === 'paused_transient' ? 'Paused' :
  run?.stage === 'waiting_retry' ? 'Waiting - automatic retry' :
  run?.stage === 'resolving_uncertain' ? 'Resolving invitation result' :
  run?.stage === 'search_exhausted' ? 'Catalog exhausted' :
  run?.stage === 'search_contract_suspect' ? 'Search response suspected' :
  run?.stage === 'daily_window_closed' ? 'Partial - day closed' :
  run ? LABELS[run.status] || run.status : 'Not run today'

export const connectionPollDelay = () => 15_000

export function connectionLocalDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric',
    month: '2-digit', day: '2-digit' }).formatToParts(now)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function connectionRunCanStart(run, hasStack = true, today = connectionLocalDate()) {
  if (run?.status === 'uncertain' || run?.stage === 'resolving_uncertain') return false
  if (!run || (run.localDate && run.localDate !== today)) return true
  if (connectionRunActive(run, today)) return false
  if (!['succeeded', 'stopped'].includes(run.status)) return true
  const target = Number(hasStack ? run.dailyLimit : run.dailyQuota)
  return !target || Number(run.counters?.sent || 0) < target
}

export function connectionPauseFromError(error) {
  const code = String(error?.body?.error || '')
  const transient = new Set(['noco_rate_limited', 'noco_timeout', 'noco_unreachable',
    'noco_service_unavailable', 'noco_http_429', 'noco_http_502', 'noco_http_503',
    'noco_http_504'])
  if (!transient.has(code)) return null
  return { code: code || 'noco_temporarily_unavailable',
    message: 'NocoDB is temporarily busy. Wait, then retry.' }
}

export function connectionRunConfirmation(account, run, safeRecruiterOnly = false) {
  const sameDay = run?.localDate === connectionLocalDate()
  const recruiterTarget = sameDay ? Number(run?.audienceQuota?.recruiter || 0) : 0
  const technicalTarget = sameDay && !safeRecruiterOnly
    ? Number(run?.audienceQuota?.technical || 0) : 0
  const recruiterRemaining = sameDay ? Math.max(0, recruiterTarget -
    Number(run?.counters?.sentByAudience?.recruiter || 0)) : recruiterTarget
  const technicalRemaining = sameDay ? Math.max(0, technicalTarget -
    Number(run?.counters?.sentByAudience?.technical || 0)) : technicalTarget
  const target = recruiterTarget + technicalTarget
  const remaining = recruiterRemaining + technicalRemaining
  const quota = remaining > 0 ? `up to ${remaining}` : 'the calculated daily quota of'
  const mode = safeRecruiterOnly ? 'recruiters only' : 'the planned 70/30 mix'
  const breakdown = target > 0
    ? `; remaining ${recruiterRemaining} recruiters / ${technicalRemaining} technical` : ''
  return `LIVE LinkedIn action: send ${quota} real invitations for ${account.clientName} ` +
    `(${mode}${breakdown}). Continue?`
}

export const connectionStopConfirmation = account =>
  `Stop this connection run for ${account.clientName}? No new invitation will start after the current request/read-back.`

export function connectionQuotaLabel(run) {
  if (!run?.dailyLimit) return 'Daily quota not calculated'
  return `${run.connectionCount} connections / ${run.dailyLimit}/day / ${run.dailyQuota || 0} today`
}

export function connectionAudienceLabel(run) {
  const quota = run?.audienceQuota || {}
  return `${quota.recruiter || 0} recruiters / ${quota.technical || 0} technical`
}

export function connectionFilterDiagnostics(run, prefix, limit = 4) {
  return Object.entries(run?.skipReasonCounters || {})
    .filter(([key]) => key.startsWith(`${prefix}:`))
    .map(([key, count]) => [key.slice(prefix.length + 1), Number(count || 0)])
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
}

export function connectionFunnelLabel(run, audience) {
  const funnel = run?.counters?.filterFunnel?.[audience]
  if (!funnel) return ''
  return `${audience}: ${funnel.found} found / ${funnel.structurallyValid} valid / ` +
    `${funnel.roleMatched} role / ${funnel.historyClear} history / ` +
    `${funnel.preflightPassed} preflight / ${funnel.claimed} claimed / ${funnel.sent} sent`
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
