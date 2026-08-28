const LABELS = {
  running: 'Running', paused: 'Needs stack', succeeded: 'Completed', failed: 'Failed',
  uncertain: 'Read-back required', stopped: 'Stopped'
}
export const latestConnectionRun = (runs, platformAccountId) => runs.find(run =>
  Number(run.platformAccountId) === Number(platformAccountId)) || null

export const connectionRunActive = run => run?.status === 'running'
export const connectionRunLabel = run => run ? LABELS[run.status] || run.status : 'Not run today'

export function connectionRunConfirmation(account, run, safeRecruiterOnly = false) {
  const quota = Number(run?.dailyLimit) > 0 ? `up to ${run.dailyLimit}` : 'the calculated daily quota of'
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
