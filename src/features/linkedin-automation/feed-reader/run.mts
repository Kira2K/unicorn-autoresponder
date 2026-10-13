import { createRequire } from 'node:module'
import { createFeedSession, stepFeedSession, feedPause } from './session.mts'
import { assessCards, draftComment, selectPosts } from './selection.mts'
import type { FeedSession, FeedDependencies } from './session.mts'
import { MAX_HOME_FEED_COUNT } from '../../../integrations/unipile/home-feed.mts'
import type { FeedCard } from '../../../integrations/unipile/home-feed.mts'
import type { Assessment, FeedModel } from './selection.mts'
const { ACTION_RECOVERY_MS } = createRequire(import.meta.url)('../action-recovery.ts') as typeof import('../action-recovery.ts')

export type PreparedPost = { id: string; authorId: string; text: string; canReact: boolean; canComment: boolean; reacted: boolean }
export type FeedAction = {
  key: string; kind: 'like' | 'comment'; cardId: string; postId?: string; text?: string
  state: 'ready' | 'sending' | 'verifying' | 'confirmed' | 'skipped' | 'unknown'
  attemptedAt?: number; commentId?: string; nextAt?: number; firstFailedAt?: number; error?: string; httpStatus?: number
}
export type FeedRun = {
  version: 1; id: string; accountId: string; ownerId: string
  phase: 'collecting' | 'preparing' | 'acting' | 'completed' | 'stopped' | 'needs_attention'
  stage: string; reason?: string; nextAt?: number
  modelError?: { code: string; httpStatus?: number }
  feed: FeedSession; assessments: Assessment[]; excluded: string[]
  selection?: { likes: string[]; comment?: string }; prepared: Record<string, PreparedPost>
  actions: FeedAction[]
}
export type FeedRunDependencies = {
  now(): number; random(): number; signal?: AbortSignal
  // The caller uses the existing account gate and saves state atomically with history.
  // It must reject stale versions/owners. Storage errors propagate, never turn into retries.
  save(state: FeedRun): Promise<void>
  assertActive(): Promise<void>
  read: FeedDependencies['read']; model: FeedModel
  provider: {
    prepare(card: FeedCard): Promise<PreparedPost>
    like(postId: string): Promise<void>
    comment(postId: string, text: string): Promise<{ id: string }>
    verify(action: FeedAction): Promise<boolean>
  }
}
const finished = new Set(['completed', 'stopped', 'needs_attention'])
const actionFinished = new Set(['confirmed', 'skipped', 'unknown'])
export function createFeedRun(input: { id: string; accountId: string; ownerId: string; now: number; excluded: string[] }): FeedRun {
  if (!input.id || !input.ownerId || !Array.isArray(input.excluded)) throw new Error('feed_run_invalid')
  return { version: 1, id: input.id, accountId: input.accountId, ownerId: input.ownerId,
    phase: 'collecting', stage: 'feed_read', feed: createFeedSession({ accountId: input.accountId, now: input.now, randomPageSize: true, maxPages: 4 }),
    assessments: [], excluded: [...new Set(input.excluded)], prepared: {}, actions: [] }
}
export function feedRunSummary(run: FeedRun) {
  const count = (kind: FeedAction['kind'], state: FeedAction['state']) => run.actions.filter(a => a.kind === kind && a.state === state).length
  return { cards: run.feed.ids.length, pages: run.feed.pages, likes: count('like', 'confirmed'),
    comments: count('comment', 'confirmed'), skipped: run.actions.filter(a => a.state === 'skipped').length,
    unconfirmed: run.actions.filter(a => ['sending', 'verifying', 'unknown'].includes(a.state)).length }
}
export function feedRecoveryDeadline(run: FeedRun): number | undefined {
  if (finished.has(run.phase)) return undefined
  return Math.min(run.phase === 'collecting' ? run.feed.expiresAt : run.feed.startedAt + 60 * 60_000,
    ...run.actions.filter(a => !actionFinished.has(a.state)).flatMap(a => {
      const started = ['sending', 'verifying'].includes(a.state) ? a.attemptedAt : a.firstFailedAt
      return started === undefined ? [] : [started + ACTION_RECOVERY_MS]
    }))
}
export function feedResumeBlockedReason(run: FeedRun | undefined, now: number): string | undefined {
  if (!run) return undefined
  if (now >= run.feed.startedAt + 60 * 60_000 || !run.selection && now >= run.feed.expiresAt) return 'feed_run_expired'
  if (!run.selection && (run.feed.phase === 'reading' || run.feed.phase === 'needs_attention' && run.feed.reason !== 'feed_graphql_error')) return 'feed_read_recovery_unsafe'
  return undefined
}
function failure(error: any, now: number) {
  const raw = Number(error?.details?.httpStatus), status = raw >= 400 && raw <= 599 ? raw : undefined
  const retry = Number(error?.details?.retryAt)
  const code = String(error?.code ?? error?.message ?? 'feed_action_failed')
  return { code: /^[a-z][a-z0-9_]{0,90}$/.test(code) ? code : status ? `unipile_http_${status}` : 'feed_action_failed',
    status, notSent: error?.notSent === true,
    nextAt: Number.isSafeInteger(retry) && retry > now ? retry : now + (status === 429 || code === 'unipile_shared_cooldown' ? 7_200_000 : 300_000) }
}

/** One saved logical step. No timers, scheduler, ENV access or background work. */
export async function stepFeedRun(previous: FeedRun, deps: FeedRunDependencies): Promise<FeedRun> {
  if (previous.version !== 1 || previous.feed.accountId !== previous.accountId ||
    !Number.isInteger(previous.feed.count) || previous.feed.count < 1 || previous.feed.count > MAX_HOME_FEED_COUNT ||
    previous.actions.filter(a => a.kind === 'like').length > 5 || previous.actions.filter(a => a.kind === 'comment').length > 1 ||
    new Set(previous.actions.map(a => a.key)).size !== previous.actions.length ||
    previous.actions.some(a => !['like', 'comment'].includes(a.kind) ||
      !['ready', 'sending', 'verifying', 'confirmed', 'skipped', 'unknown'].includes(a.state)) ||
    previous.phase === 'acting' && previous.actions.some(a => !actionFinished.has(a.state) &&
      (!a.postId || a.kind === 'comment' && !a.text))) throw new Error('feed_run_invalid')
  const run = structuredClone(previous)
  const save = async () => { await deps.save(structuredClone(run)); return run }
  const complete = () => {
    run.phase = 'completed'; run.stage = 'feed_finished'; delete run.nextAt
    const totals = feedRunSummary(run)
    run.reason = totals.likes === 5 && totals.comments === 1 ? 'target_reached' : 'partial_result'
    return save()
  }
  if (finished.has(run.phase)) return run
  const expiresAt = run.phase === 'collecting' ? run.feed.expiresAt : run.feed.startedAt + 60 * 60_000
  if (deps.signal?.aborted || deps.now() >= expiresAt) {
    run.phase = 'stopped'; run.reason = deps.signal?.aborted ? 'user_stop' : 'session_expired'
    for (const action of run.actions) if (['sending', 'verifying'].includes(action.state)) action.state = 'unknown'
    return save()
  }
  // Expiry is local: honour the provider pause while releasing an unresolved action.
  // The orchestrator wakes at this deadline even when Retry-After is much longer.
  let expiredAction = false
  for (const action of run.actions.filter(a => !actionFinished.has(a.state))) {
    const sent = ['sending', 'verifying'].includes(action.state)
    const started = sent ? action.attemptedAt : action.firstFailedAt
    if (started === undefined || deps.now() < started + ACTION_RECOVERY_MS) continue
    action.state = sent ? 'unknown' : 'skipped'
    action.error ??= sent ? 'feed_verification_expired' : 'feed_action_expired'
    if (run.phase === 'preparing') for (const related of run.actions.filter(a => a.cardId === action.cardId)) {
      related.state = 'skipped'; related.error = action.error
    }
    expiredAction = true
  }
  if (expiredAction) { run.stage = 'feed_action_expired'; return save() }
  if ((run.nextAt ?? 0) > deps.now()) return run
  await deps.assertActive()
  deps.signal?.throwIfAborted()

  if (run.phase === 'collecting') {
    const cards = run.feed.cards ?? [], assessed = new Set(run.assessments.map(a => a.id))
    // Keep model batches bounded even when the provider returns a large page.
    const pending = cards.filter(card => !assessed.has(card.id)).slice(0, 20)
    if (pending.length) {
      delete run.modelError
      run.stage = 'feed_classify'; await save()
      const eligible: FeedCard[] = []
      for (const card of pending) {
        const reason = card.sponsored ? 'Реклама' : run.excluded.includes(card.id) ? 'Уже обработан' :
          card.reacted ? 'Лайк уже стоит' : card.authorId === run.ownerId ? 'Собственный пост' :
          card.canReact === false ? 'Реакции запрещены' : !card.text.trim() && !card.resharedText.trim() ? 'Нет текста для оценки' : undefined
        if (reason) run.assessments.push({ id: card.id, category: 'other', reason })
        else eligible.push(card)
      }
      try { run.assessments.push(...await assessCards(eligible, deps.model)) }
      catch (error) {
        const issue = failure(error, deps.now())
        run.phase = 'needs_attention'; run.reason = issue.code
        run.modelError = { code: issue.code, httpStatus: issue.status }
      }
      return save() // Classification is saved before deciding whether to fetch another page.
    }
    const choice = selectPosts(cards, run.assessments, run.excluded)
    if (choice.likes.length === 5 && choice.comment && !run.feed.batchRemaining || run.feed.phase === 'completed') {
      run.selection = choice; run.phase = 'preparing'; run.stage = 'feed_selected'
      run.nextAt = run.feed.nextAt // Classification does not cancel the saved network pause.
      run.actions = choice.likes.map(cardId => ({ key: `${run.accountId}:${cardId}:like`, cardId, kind: 'like', state: 'ready' }))
      if (choice.comment) run.actions.push({ key: `${run.accountId}:${choice.comment}:comment`, cardId: choice.comment, kind: 'comment', state: 'ready' })
      if (!run.actions.length) { run.phase = 'completed'; run.reason = 'no_professional_posts' }
      return save()
    }
    if (['stopped', 'needs_attention'].includes(run.feed.phase)) {
      run.phase = run.feed.phase as 'stopped' | 'needs_attention'; run.reason = run.feed.reason; return save()
    }
    run.stage = 'feed_read'
    run.feed = await stepFeedSession(run.feed, { ...deps, save: async feed => { run.feed = feed; await save() } })
    if (run.feed.phase === 'needs_attention' || run.feed.phase === 'stopped') {
      run.phase = run.feed.phase; run.reason = run.feed.reason
      return save()
    }
    // Evaluate already saved data before waiting for the next page. No second read here.
    run.nextAt = (run.feed.cards ?? []).some(c => !run.assessments.some(a => a.id === c.id)) ? undefined : run.feed.nextAt
    return save()
  }

  if (run.phase === 'preparing') {
    const action = run.actions.find(a => a.kind === 'like' && a.state === 'ready' && !a.postId)
    if (action) {
      const card = run.feed.cards!.find(c => c.id === action.cardId)!
      if (action.firstFailedAt !== undefined && deps.now() >= action.firstFailedAt + ACTION_RECOVERY_MS) {
        for (const a of run.actions.filter(a => a.cardId === card.id)) { a.state = 'skipped'; a.error = action.error }
        return save()
      }
      run.stage = 'feed_post_prepare'; await save()
      let post: PreparedPost | undefined
      try { post = await deps.provider.prepare(card) }
      catch (error) {
        const issue = failure(error, deps.now()); action.error = issue.code; action.httpStatus = issue.status
        action.firstFailedAt ??= deps.now()
        if (deps.now() - action.firstFailedAt >= ACTION_RECOVERY_MS || issue.status && issue.status < 500 && issue.status !== 429) {
          for (const a of run.actions.filter(a => a.cardId === card.id)) { a.state = 'skipped'; a.error = issue.code }
        } else run.nextAt = issue.nextAt
        return save()
      }
      if (!post.id || typeof post.text !== 'string' || !post.authorId ||
        ['canReact', 'canComment', 'reacted'].some(key => typeof post![key as keyof PreparedPost] !== 'boolean'))
        throw new Error('feed_prepared_post_invalid')
      run.prepared[card.id] = post
      // A changed post must not inherit the classification of an older feed snapshot.
      let contentChanged = false
      if (post.text.trim().replace(/\s+/g, ' ') !== card.text.trim().replace(/\s+/g, ' ')) {
        await save()
        try { contentChanged = (await assessCards([{ ...card, text: post.text, resharedText: '' }], deps.model))[0].category !== 'professional' }
        catch { contentChanged = true }
      }
      const duplicate = run.actions.some(a => a.cardId !== card.id && a.postId === post.id)
      for (const a of run.actions.filter(a => a.cardId === card.id)) {
        a.postId = post.id
        if (contentChanged || duplicate || post.authorId === run.ownerId || post.reacted || !post.canReact || a.kind === 'comment' && !post.canComment) {
          a.state = 'skipped'; a.error = 'feed_post_ineligible'
        }
      }
      run.nextAt = deps.now() + feedPause(deps.random)
      return save()
    }
    const comment = run.actions.find(a => a.kind === 'comment' && a.state === 'ready')
    if (comment && !comment.text) {
      run.stage = 'feed_comment_draft'; await save()
      try {
        const card = run.feed.cards!.find(c => c.id === comment.cardId)!
        comment.text = await draftComment({ ...card, text: run.prepared[card.id].text }, deps.model)
        if (!comment.text) { comment.state = 'skipped'; comment.error = 'feed_comment_no_context' }
      } catch (error) {
        const issue = failure(error, deps.now())
        comment.state = 'skipped'; comment.error = issue.code; comment.httpStatus = issue.status
      }
      return save()
    }
    run.phase = 'acting'; run.stage = 'feed_actions'; return save()
  }

  const action = run.actions.find(a => !actionFinished.has(a.state))
  if (!action) return complete()
  if ((action.nextAt ?? 0) > deps.now()) { run.nextAt = action.nextAt; return save() }
  if (action.state === 'sending') action.state = 'verifying' // Restored intent never permits another POST.
  if (action.state === 'verifying') {
    if (deps.now() >= (action.attemptedAt ?? deps.now()) + ACTION_RECOVERY_MS) {
      action.state = 'unknown'; action.error ??= 'feed_verification_expired'; return save()
    }
    run.stage = action.kind === 'like' ? 'feed_like_verify' : 'feed_comment_verify'; await save()
    try {
      if (await deps.provider.verify(structuredClone(action))) action.state = 'confirmed'
      else { action.nextAt = deps.now() + 300_000; action.error = 'feed_result_not_observed' }
    } catch (error) {
      const issue = failure(error, deps.now()); action.error = issue.code; action.httpStatus = issue.status; action.nextAt = issue.nextAt
    }
    // A verified final action has no next request to pace; persist completion before expiry.
    if (run.actions.every(a => actionFinished.has(a.state))) return complete()
    run.nextAt = action.state === 'confirmed' ? deps.now() + feedPause(deps.random) : action.nextAt
    return save()
  }
  if (action.kind === 'comment') {
    const like = run.actions.find(a => a.kind === 'like' && a.cardId === action.cardId)
    if (like?.state !== 'confirmed') { action.state = 'skipped'; action.error = 'feed_like_not_confirmed'; return save() }
  }
  if (action.firstFailedAt !== undefined && deps.now() >= action.firstFailedAt + ACTION_RECOVERY_MS) {
    action.state = 'skipped'; return save()
  }
  await deps.assertActive(); deps.signal?.throwIfAborted()
  const nextAt = deps.now() + feedPause(deps.random)
  action.state = 'sending'; action.attemptedAt = deps.now(); action.nextAt = nextAt
  run.stage = action.kind === 'like' ? 'feed_like_send' : 'feed_comment_send'
  await save() // Durable intent precedes every mutation, including the first one.
  if (deps.signal?.aborted) { run.phase = 'stopped'; run.reason = 'user_stop'; return save() }
  try {
    await deps.assertActive(); deps.signal?.throwIfAborted()
    if (action.kind === 'like') await deps.provider.like(action.postId!)
    else action.commentId = (await deps.provider.comment(action.postId!, action.text!)).id
    action.state = 'verifying'
  } catch (error) {
    const issue = failure(error, deps.now()); action.error = issue.code; action.httpStatus = issue.status
    action.firstFailedAt ??= deps.now()
    // Only the request boundary can prove that a write was not dispatched.
    action.state = issue.notSent ? 'ready' : 'verifying'
    action.nextAt = Math.max(nextAt, issue.nextAt)
  }
  run.nextAt = action.nextAt
  if (deps.signal?.aborted) { run.phase = 'stopped'; run.reason = 'user_stop' }
  return save() // A failed outcome save leaves the durable 'sending' intent for read-only recovery.
}
