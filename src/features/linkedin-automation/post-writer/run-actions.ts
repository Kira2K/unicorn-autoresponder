import { PostError } from './errors.ts'
import { active, type Dependencies, type ManualMode, type PostRun } from './types.ts'
import { runContentHash } from './run-content.ts'
export function newRun(id: string, account: number, trigger: 'manual' | 'scheduled', mode: ManualMode,
  likes: boolean, deps: Pick<Dependencies, 'writerId' | 'now'>): PostRun {
  return { id, account, trigger, mode: trigger === 'scheduled' ? 'automatic' : mode,
    likesEnabled: likes, executorId: deps.writerId, status: 'queued', createdAt: deps.now(),
    updatedAt: deps.now(), repairCount: 0, issues: [], stop: false,
    engagement: { status: 'off', target: 0, items: [] } }
}
export function applyAction(run: PostRun, action: string, hash?: string, memeReviewedHash?: string) {
  if (action === 'stop') {
    run.stop = true
    // The processor still reconciles any operation that has already started.
    if (!run.attemptedAt && !run.engagement.items.some(item => item.status === 'sending')) {
      run.status = 'stopped'
    }
    return
  }
  if (run.status !== 'awaiting_approval' || run.trigger !== 'manual' ||
    run.mode !== 'approval_required' || run.stop) throw new PostError('post_action_invalid')
  if (action === 'reject') { run.status = 'rejected'; return }
  if (action !== 'approve' || !hash || hash !== run.hash || !run.draft ||
    runContentHash(run) !== hash || run.issues.length) throw new PostError('post_hash_mismatch')
  if (run.memeEnabled && memeReviewedHash !== hash) throw new PostError('meme_review_required')
  run.memeReviewedHash = run.memeEnabled ? hash : undefined
  run.approvedHash = hash
  run.status = 'ready'
}
export const accountActive = (runs: Iterable<PostRun>, account: number) =>
  [...runs].find(run => run.account === account && active(run))
