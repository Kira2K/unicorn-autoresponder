import type { PostRun } from './types.ts'
import { PostError } from './errors.ts'

export const canStartManualLikes = (run: PostRun) => run.trigger === 'manual' &&
  run.status === 'published' && !!run.postId && !!run.target?.verifiedProviderId && !run.stop &&
  !run.likesEnabled && run.engagement.status === 'off' && !run.engagement.requestedManually &&
  run.engagement.target === 0 && run.engagement.items.length === 0

export const canResumeManualLikes = (run: PostRun) => run.trigger === 'manual' &&
  run.status === 'published' && !!run.postId && !!run.target?.verifiedProviderId && !run.stop &&
  run.likesEnabled && run.engagement.requestedManually === true && run.engagement.status === 'partial' &&
  run.errorCode === 'post_account_not_ready' && run.engagement.items.some(item => item.status === 'pending') &&
  run.engagement.items.every(item => ['sent', 'failed'].includes(item.status) ||
    (item.status === 'pending' && item.attemptedAt === undefined))

/** Queue likes once for this published post; never change future-post settings. */
export function startManualLikes(run: PostRun): boolean {
  if (canResumeManualLikes(run)) {
    run.engagement.status = 'running'
    run.errorCode = undefined; run.nextActionAt = undefined
    return true
  }
  if (run.trigger === 'manual' && run.status === 'published' && !run.stop &&
    run.engagement.requestedManually) return false
  if (!canStartManualLikes(run)) throw new PostError('post_likes_start_invalid')
  run.likesEnabled = true
  run.engagement = { status: 'pending', target: 0, items: [], requestedManually: true }
  run.nextActionAt = undefined
  return true
}
