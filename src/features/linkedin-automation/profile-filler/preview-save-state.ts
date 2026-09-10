import type { ProfileJob } from './job-types.ts'
import { validCheckpoint } from './generation/checkpoint.ts'
import { nocoRetryAfterMs } from '../../../integrations/noco/core/error-policy.ts'
import { profileErrorCode } from './errors.ts'

export function previewSaveRecovery(job: ProfileJob): 'save' | 'rebuild' | undefined {
  if (job.result || !['failed', 'waiting_retry'].includes(job.status) ||
    !['preview_failed', 'waiting_preview_save'].includes(job.phase) || !validCheckpoint(job.checkpoint)) return
  const pending = job.checkpoint.pendingPreview
  if (pending?.plan && pending.planHash) return 'save'
  if (job.errorCode === 'noco_rate_limited') return 'rebuild'
}

export function previewSaveFailure(job: ProfileJob, error: unknown, now = Date.now()): Partial<ProfileJob> {
  const checkpoint = structuredClone(job.checkpoint!)
  const supplied = nocoRetryAfterMs(error, now) ?? Number((error as { details?: { retryAfterMs?: unknown } })?.details?.retryAfterMs)
  const delay = Math.max(30_000, Number.isFinite(supplied) ? supplied : 0)
  if (checkpoint.pendingPreview) checkpoint.pendingPreview.nextRetryAt = new Date(now + delay).toISOString()
  return { status: 'waiting_retry', phase: 'waiting_preview_save', checkpoint,
    errorCode: profileErrorCode(error), updatedAt: new Date(now).toISOString() }
}
