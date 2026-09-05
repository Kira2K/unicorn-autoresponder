export function jobElapsedSeconds(job, now = Date.now()) {
  if (!job?.createdAt) return 0
  const active = ['generating_cv', 'generating_profile', 'validating', 'previewing',
    'retrying', 'running', 'verifying'].includes(job.status)
  const end = active ? now : Date.parse(job.finishedAt || job.updatedAt)
  return Math.max(0, Math.floor((end - Date.parse(job.createdAt)) / 1000))
}

export function jobRetrySeconds(job, now = Date.now()) {
  if (!job?.retry?.nextRetryAt) return 0
  return Math.max(0, Math.ceil((Date.parse(job.retry.nextRetryAt) - now) / 1000))
}
