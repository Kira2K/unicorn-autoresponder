import { PostError } from './errors.ts'
import type { PostRun } from './types.ts'

const repairable = ['meme_prompt_invalid', 'meme_concept_invalid', 'meme_caption_invalid', 'meme_duplicate_concept']
export function canRetryMeme(run: PostRun) {
  return run.status === 'blocked' && !run.stop && run.memeEnabled === true &&
    Boolean(run.draft && run.topic && run.context && run.target) && run.issues.length === 0 &&
    run.attemptedAt === undefined && !run.postId && !run.postImageId && !run.url && run.publishedAt === undefined &&
    run.meme?.status === 'blocked' && run.meme.imageCalls === 0 && run.meme.plannerCalls === 1 &&
    repairable.includes(run.errorCode ?? '') && run.meme.errorCode === run.errorCode
}
export function retryMeme(run: PostRun) {
  if (!canRetryMeme(run)) throw new PostError('post_meme_retry_invalid')
  // Keep the same job, text and charged-attempt count. Only the received bad concept is repairable.
  run.meme!.status = 'repair_pending'
  run.status = 'queued'
  run.errorCode = undefined
  run.nextActionAt = undefined
  run.hash = undefined
  run.approvedHash = undefined
  run.memeReviewedHash = undefined
}
