const LABELS = {
  running: 'Running', paused: 'Needs stack', succeeded: 'Completed', failed: 'Failed',
  uncertain: 'Read-back required'
}
export const latestConnectionRun = (runs, platformAccountId) => runs.find(run =>
  Number(run.platformAccountId) === Number(platformAccountId)) || null

export const connectionRunActive = run => run?.status === 'running'
export const connectionRunLabel = run => run ? LABELS[run.status] || run.status : 'Not run today'

export function connectionQuotaLabel(run) {
  if (!run?.weeklyLimit) return 'Weekly quota not calculated'
  return `${run.connectionCount} connections · ${run.weeklyLimit}/week · ${run.dailyQuota || 0} today`
}

export function connectionAudienceLabel(run) {
  const quota = run?.audienceQuota || {}
  return `${quota.recruiter || 0} recruiters · ${quota.technical || 0} technical`
}
