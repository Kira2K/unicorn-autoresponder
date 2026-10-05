import { lock, unlock, type EngagementExecution } from './execution-types.ts'
import { errorCode, retryDelay } from './errors.ts'
import type { Like, PostRun } from './types.ts'
import { recordFailure, recoveryExpired, recoveryWakeAt, skipRecovery, ACTION_SKIPPED, summaryMessage } from '../action-recovery.ts'
import * as requestControl from '../../../integrations/unipile/request-control.ts'
const { withRequestContext } = (requestControl as any).default ?? requestControl
const actorAction = <T>(run: PostRun, item: Like, action: () => Promise<T>): Promise<T> =>
  withRequestContext({ actionId: `like:${run.id}:${item.account.platformAccountId}` }, action)
const likesAllowed = (run: PostRun, e: EngagementExecution) => !run.stop && run.likesEnabled &&
  (run.engagement.requestedManually || e.settings(run.account).likes)
const actorAllowed = (run: PostRun, id: number, e: EngagementExecution) => {
  const ids = run.engagement.requestedManually ? run.engagement.accountIds : e.settings(run.account).likeAccountIds
  return ids === undefined || ids.includes(id)
}
const unknown = (item: Like) => item.recovery?.skippedAt === undefined && ['sending', 'uncertain'].includes(item.status)
const due = (item: Like, now: number) => !item.nextActionAt || item.nextActionAt <= now
const confirmed = (item: Like, now: number) => {
  item.status = 'sent'; item.confirmedAt = now; delete item.nextActionAt; delete item.errorCode
  delete item.recovery
}
function deferConfirmation(item: Like, now: number) {
  const age = Math.max(0, now - (item.attemptedAt ?? now))
  const delay = age < 15 * 60_000 ? 5 * 60_000 : age < 3600_000 ? 15 * 60_000 : age < 2 * 3600_000 ? 3600_000 : 2 * 3600_000
  item.status = 'uncertain'; item.nextActionAt = recoveryWakeAt(item.recovery, now + delay)
}

function failureDeadline(error: unknown, now: number) {
  const code = errorCode(error)
  if (code === 'post_persistence_unavailable' || code.startsWith('automation_')) throw error
  return now + (retryDelay(error, now) ?? (code === 'linkedin_operation_active' ? 15_000 : 300_000))
}

async function failActor(run: PostRun, e: EngagementExecution, item: Like, error: unknown) {
  const until = failureDeadline(error, e.now()), code = errorCode(error)
  const recovery = recordFailure(item.recovery, error, e.now())
  if (recovery) item.recovery = recovery
  item.errorCode = code; run.errorCode = code
  if (unknown(item)) {
    item.status = 'uncertain'
    if (e.now() - (item.attemptedAt ?? e.now()) >= 15 * 60_000) deferConfirmation(item, e.now())
  }
  if (item.status === 'pending' && code === 'post_account_not_ready' && retryDelay(error, e.now()) === undefined) {
    item.status = 'failed'; delete item.nextActionAt
  } else item.nextActionAt = recoveryWakeAt(item.recovery, Math.max(item.nextActionAt ?? 0, until))
  await e.save(run)
}

// The run timer is only the earliest runnable item, never one actor's provider deadline.
async function finishStep(run: PostRun, e: EngagementExecution, paced = false) {
  const active = run.engagement.items.filter(item => item.status === 'pending' || unknown(item))
  if (active.length) {
    run.engagement.status = active.some(item => item.status === 'uncertain') || !active.some(item => item.status === 'pending') ? 'uncertain' : 'running'
    run.nextActionAt = Math.max(e.now() + (paced ? 5000 + Math.floor(e.random() * 85_001) : 0),
      Math.min(...active.map(item => item.nextActionAt ?? e.now())))
  } else {
    run.engagement.status = !likesAllowed(run, e) ? 'cancelled' :
      run.engagement.items.filter(item => item.status === 'sent').length >= run.engagement.target ? 'completed' : 'partial'
    run.nextActionAt = undefined
    run.errorCode = undefined
    e.log?.('likes_summary', { runId: run.id, message: summaryMessage({
      completed: run.engagement.items.filter(item => item.status === 'sent').length,
      skipped: run.engagement.items.filter(item => ['failed', 'cancelled'].includes(item.status)).length,
      unconfirmed: run.engagement.items.filter(item => ['sending', 'uncertain'].includes(item.status)).length }) })
  }
  await e.save(run)
}

async function readReactions(run: PostRun, e: EngagementExecution, actors: string[]) {
  let held = false
  try {
    lock(e, run.target!.platformAccountId, run.id, 'post_likes_check'); held = true
    const found = await withRequestContext({ actionId: `likes:${run.id}:readback` },
      () => e.adapter.reactions!(run.target!, run.postId!, actors))
    run.engagement.readNotBefore = undefined
    return found
  } catch (error) {
    // Other actors can read their own reaction while this batch reader is unavailable.
    run.engagement.readNotBefore = Math.max(run.engagement.readNotBefore ?? 0, failureDeadline(error, e.now()))
    for (const item of run.engagement.items.filter(item => actors.includes(item.account.verifiedProviderId))) {
      const recovery = recordFailure(item.recovery, error, e.now())
      if (recovery) item.recovery = recovery
      if (item.recovery && item.nextActionAt) item.nextActionAt = recoveryWakeAt(item.recovery, item.nextActionAt)
    }
    run.errorCode = errorCode(error); await e.save(run)
    return undefined
  } finally { if (held) unlock(e, run.target!.platformAccountId) }
}

function freshSnapshot(run: PostRun, now: number) {
  const snapshot = run.engagement.reactionSnapshot
  return snapshot && snapshot.accountId === run.target?.unipileAccountId && snapshot.postId === run.postId &&
    Number.isFinite(snapshot.at) && snapshot.at <= now && now - snapshot.at < 5 * 60_000 ? snapshot : undefined
}
const canReadBatch = (run: PostRun, e: EngagementExecution) => e.adapter.reactions && run.target &&
  !(run.engagement.readNotBefore && run.engagement.readNotBefore > e.now())

async function confirmLikes(run: PostRun, e: EngagementExecution, items: Like[]) {
  const snapshot = freshSnapshot(run, e.now())
  for (const item of items) if (snapshot && snapshot.at >= (item.acceptedAt ?? item.attemptedAt ?? Infinity) &&
    snapshot.found.includes(item.account.verifiedProviderId)) confirmed(item, e.now())
  const remaining = items.filter(unknown)
  if (!remaining.length) return
  if (canReadBatch(run, e)) {
    const found = await readReactions(run, e, remaining.map(item => item.account.verifiedProviderId))
    if (!found) return
    for (const item of remaining) if (found.includes(item.account.verifiedProviderId)) confirmed(item, e.now())
    else deferConfirmation(item, e.now())
  } else for (const item of remaining) {
    let held = false
    try {
      lock(e, item.account.platformAccountId, run.id, 'post_likes_check'); held = true
      if (await actorAction(run, item, () => e.adapter.reacted(item.account, run.postId!))) confirmed(item, e.now())
      else deferConfirmation(item, e.now())
    } catch (error) { await failActor(run, e, item, error) }
    finally { if (held) unlock(e, item.account.platformAccountId) }
  }
}

export async function engage(run: PostRun, e: EngagementExecution) {
  if (e.isClosing?.() || !run.postId || !['pending', 'running', 'uncertain'].includes(run.engagement.status)) return
  for (const item of run.engagement.items) if (item.status !== 'sent' && item.recovery?.skippedAt === undefined && recoveryExpired(item.recovery, e.now())) {
    skipRecovery(item.recovery!, e.now()); item.errorCode = ACTION_SKIPPED; item.nextActionAt = undefined
    item.status = item.attemptedAt ? 'uncertain' : 'failed'
    await e.save(run)
    e.log?.('action_skipped', { runId: run.id, account: item.account.platformAccountId, code: ACTION_SKIPPED,
      httpStatus: item.recovery?.httpStatus ?? 500, stage: item.recovery?.stage ?? 'likes',
      errorCode: item.recovery?.errorCode ?? 'unipile_server_error', requestId: item.recovery?.requestId ?? '',
      message: 'Лайк пропущен после 20 минут восстановления. Неизвестный результат не разрешает повторную отправку.' })
  }
  if (run.engagement.status === 'pending' && likesAllowed(run, e)) {
    const selection = run.engagement.accountIds ?? e.settings(run.account).likeAccountIds
    if (selection !== undefined) run.engagement.accountIds = [...selection]
    run.engagement.target = selection === undefined ? (e.random() < 0.5 ? 6 : 7) : selection.length
    const ids = new Set<string>()
    const available = (await e.source.accounts()).filter(account => {
      if (selection !== undefined && !selection.includes(account.platformAccountId)) return false
      if (account.verifiedProviderId === run.target?.verifiedProviderId || ids.has(account.verifiedProviderId)) return false
      ids.add(account.verifiedProviderId); return true
    }).map(account => ({ account, order: e.random() })).sort((a, b) => a.order - b.order)
    run.engagement.items = available.slice(0, run.engagement.target).map(({ account }) => ({ account, status: 'pending' }))
    await finishStep(run, e, true); return
  }
  for (const item of run.engagement.items) if (item.status === 'pending' &&
    (!likesAllowed(run, e) || !actorAllowed(run, item.account.platformAccountId, e))) item.status = 'cancelled'

  // Adapters without a batch reader keep the send/read-back contract for each actor.
  // A deferred unknown result does not stop other actors from taking their turn.
  const checking = run.engagement.items.filter(row => unknown(row) && due(row, e.now()))
  if (!e.adapter.reactions && checking.length) {
    await confirmLikes(run, e, checking); await finishStep(run, e, true); return
  }

  // Send other eligible actors first; confirm the collected results together afterwards.
  const item = run.engagement.items.find(row => row.status === 'pending' && due(row, e.now()))
  if (!item) {
    await confirmLikes(run, e, run.engagement.items.filter(row => unknown(row) && due(row, e.now())))
    await finishStep(run, e, true); return
  }
  let held = false
  try {
    try {
      lock(e, item.account.platformAccountId, run.id, run.engagement.requestedManually ? 'post_likes_manual' : 'post_likes'); held = true
      await actorAction(run, item, () => e.adapter.identity(item.account))
    } catch (error) { await failActor(run, e, item, error); await finishStep(run, e, true); return }
    let reacted: boolean
    if (canReadBatch(run, e)) {
      let snapshot = freshSnapshot(run, e.now())
      const now = e.now(), actorId = item.account.verifiedProviderId
      if (!snapshot || !snapshot.actors.includes(actorId)) {
        const actors = run.engagement.items.filter(row => row.status === 'pending' || unknown(row))
          .map(row => row.account.verifiedProviderId)
        const found = await readReactions(run, e, actors)
        if (!found) { await finishStep(run, e, true); return }
        snapshot = { accountId: run.target!.unipileAccountId, postId: run.postId, at: now, actors, found }
        run.engagement.reactionSnapshot = snapshot
        await e.save(run)
      }
      reacted = snapshot.found.includes(actorId)
    } else {
      try { reacted = await actorAction(run, item, () => e.adapter.reacted(item.account, run.postId!)) }
      catch (error) { await failActor(run, e, item, error); await finishStep(run, e, true); return }
    }
    if (reacted) { confirmed(item, e.now()); await finishStep(run, e, true); return }
    if (!likesAllowed(run, e) || !actorAllowed(run, item.account.platformAccountId, e) || e.isClosing?.()) {
      item.status = 'cancelled'; await finishStep(run, e, true); return
    }
    item.status = 'sending'; item.attemptedAt = e.now(); delete item.nextActionAt
    await e.save(run)
    if (!likesAllowed(run, e) || !actorAllowed(run, item.account.platformAccountId, e) || e.isClosing?.()) {
      item.status = 'cancelled'; await finishStep(run, e, true); return
    }
    try { await actorAction(run, item, () => e.adapter.like(item.account, run.postId!)) }
    catch (error: any) {
      if (error?.notSent === true) { item.status = 'pending'; item.attemptedAt = undefined }
      await failActor(run, e, item, error); await finishStep(run, e, true); return
    }
    item.acceptedAt = e.now()
    await finishStep(run, e, true)
  } finally { if (held) unlock(e, item.account.platformAccountId) }
}
