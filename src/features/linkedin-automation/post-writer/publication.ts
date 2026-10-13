import { PostError } from './errors.ts'
import { contentHash } from './content-identity.ts'
import { runContentHash, publicationMedia, imageConfirmed, runHistory } from './run-content.ts'
import { lock, unlock, type PublicationExecution } from './execution-types.ts'
import type { PostRun } from './types.ts'
import { policyCurrent } from './run-policy.ts'

export function publicationCheckAt(run: PostRun, now: number, providerDelay?: number) {
  const age = Math.max(0, now - (run.attemptedAt ?? now))
  const delay = age < 15 * 60_000 ? (providerDelay ?? 5 * 60_000) : age < 3600_000 ? 15 * 60_000 :
    age < 24 * 3600_000 ? 3600_000 : 6 * 3600_000
  return now + Math.max(1000, delay, providerDelay ?? 0)
}

function requireCurrentPolicy(run: PostRun, e: PublicationExecution) {
  if (e.settings && !policyCurrent(run, { settings: e.settings })) {
    run.attemptedAt = undefined
    run.approvedHash = undefined
    throw new PostError('post_policy_changed')
  }
}

export async function reconcilePost(run: PostRun, e: PublicationExecution) {
  if (!run.target || !run.hash || !run.attemptedAt) throw new PostError('post_intent_missing')
  lock(e, run.account, run.id, run.trigger === 'scheduled' ? 'post_writer_automatic' : 'post_writer')
  const posts = run.postId ? [await e.adapter.read(run.target, run.postId)] : await e.adapter.recent(run.target)
  const matched = posts.filter(post => post.authorId === run.target!.verifiedProviderId &&
    contentHash(post.text) === contentHash(run.draft!.text) && imageConfirmed(run, post) &&
    post.createdAt >= run.attemptedAt! - 60_000)
  if (matched.length !== 1) {
    run.status = 'uncertain'
    run.errorCode = matched.length ? 'post_multiple_matches' : 'post_not_confirmed'
    run.nextActionAt = publicationCheckAt(run, e.now())
    await e.save(run)
    return
  }
  const post = matched[0]
  run.postId = post.id
  run.url = post.url
  run.publishedAt = post.createdAt
  run.errorCode = undefined
  run.nextActionAt = undefined
  const history = runHistory(run, 'published')
  await e.store.put('history', history.id, history)
  run.status = 'published'
  run.engagement.status = run.likesEnabled && !run.stop ? 'pending' : 'off'
  await e.save(run)
  unlock(e, run.account)
}

export async function publish(run: PostRun, e: PublicationExecution) {
  if (e.isClosing?.()) return
  if (!run.target || !run.hash || !run.draft || !run.topic || run.issues.length ||
    runContentHash(run) !== run.hash ||
    (run.mode === 'approval_required' && (run.approvedHash !== run.hash ||
      (run.memeEnabled && run.memeReviewedHash !== run.hash)))) throw new PostError('post_not_approved')
  const image = await publicationMedia(run, e.memes?.assets)
  lock(e, run.account, run.id, run.trigger === 'scheduled' ? 'post_writer_automatic' : 'post_writer')
  await e.adapter.identity(run.target)
  if (run.stop || e.isClosing?.()) { unlock(e, run.account); return }
  requireCurrentPolicy(run, e)
  const history = runHistory(run, 'sending')
  // Persist recovery before the non-atomic reservation. A crash can only reconcile.
  run.attemptedAt = e.now()
  run.status = 'publishing'
  await e.save(run)
  if (run.stop || e.isClosing?.()) { run.status = 'stopped'; await e.save(run); unlock(e, run.account); return }
  const claim = await e.store.claim(history.id, history)
  if (claim.value.runId !== run.id) {
    run.attemptedAt = undefined
    throw new PostError('post_duplicate_content')
  }
  if (!claim.created && !run.publicationNotSent) {
    run.status = 'uncertain'
    run.postId = claim.value.postId
    await e.save(run)
    return
  }
  if (run.stop || e.isClosing?.()) { run.status = 'stopped'; await e.save(run); unlock(e, run.account); return }
  // From this point every exception is ambiguous; never return this run to ready.
  requireCurrentPolicy(run, e)
  if (run.publicationNotSent) { run.publicationNotSent = false; await e.save(run) }
  let post
  try { post = await e.adapter.publish(run.target, run.draft.text, image) }
  catch (error: any) {
    if (error?.notSent === true) {
      run.publicationNotSent = true; run.attemptedAt = undefined; run.status = 'ready'; await e.save(run)
    }
    throw error
  }
  run.postId = post.id
  run.postImageId = run.memeEnabled && post.images?.length === 1 ? post.images[0].id : undefined
  run.status = 'verifying'
  run.nextActionAt = e.now() + 5000
  await e.save(run)
}
