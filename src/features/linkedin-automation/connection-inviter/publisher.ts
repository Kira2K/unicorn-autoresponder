import type { SearchAudience } from './catalog.ts'
import { connectionError, connectionErrorCode, connectionHttpStatus } from './errors.ts'
import { claimRunCandidate } from './history-claim.ts'
import { listAllPending } from './pending.ts'
import { profileAllowsInvitation, profileIsConnected } from './relation-policy.ts'
import { isUnknownWrite, sendDelay } from './run-model.ts'
import { waitOrStop } from './run-control.ts'
import { makeRetryState, waitWithRunTimer, withConnectionRetry } from './retry-state.ts'
import { requireConnectionRunDay } from './day-window.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import { invitationRequestId, pendingPersonId } from './unipile-adapter.ts'

async function updateHistory(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  item: ConnectionHistoryItem) {
  await withConnectionRetry(runtime, run, save, 'noco', 'history_update', () =>
    runtime.store.updateHistory(item), { allowAfterDayClose: true })
}

async function releaseClaimWithoutPost(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun, item: ConnectionHistoryItem, reasonCode: string,
  status: 'deferred' | 'failed' | 'pending' = 'deferred') {
  item.status = status; item.reasonCode = reasonCode
  item.updatedAt = runtime.now().toISOString()
  await updateHistory(runtime, run, save, item)
  const confirmed = await withConnectionRetry(runtime, run, save, 'noco',
    'history_release_readback', () => runtime.store.findHistory(
      item.accountId, item.personId, true), { allowAfterDayClose: true, ignoreStopRequested: true })
  if (confirmed?.recordId && confirmed.runId === run.runId &&
    confirmed.historyKey === item.historyKey && confirmed.status === status &&
    !confirmed.sentAt && !confirmed.requestId) return confirmed
  throw connectionError('noco_history_release_not_confirmed',
    'The invitation claim could not be safely released before provider POST.', { httpStatus: 503 })
}

function countSkip(runtime: ConnectionRuntime, run: ConnectionRun, item: ConnectionHistoryItem,
  reasonCode: string) {
  run.counters.skipped += 1
  const hardKey = `hard:${reasonCode}`
  const audienceKey = `audience:${item.audience}:hard:${reasonCode}`
  run.skipReasonCounters[hardKey] = (run.skipReasonCounters[hardKey] ?? 0) + 1
  run.skipReasonCounters[audienceKey] = (run.skipReasonCounters[audienceKey] ?? 0) + 1
  runtime.logger.event('candidate_skip', 'succeeded', { runId: run.runId,
    platformAccountId: run.platformAccountId, audience: item.audience, reasonCode })
}

async function claim(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  item: ConnectionHistoryItem) {
  return withConnectionRetry(runtime, run, save, 'noco', 'history_claim', () =>
    claimRunCandidate(runtime.store, item))
}

async function pendingIds(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  options: { ignoreStopRequested?: boolean; allowAfterDayClose?: boolean } = {}) {
  const rows = await withConnectionRetry(runtime, run, save, 'unipile',
    'pending_invitations_read', () => listAllPending(runtime, run.accountId),
    { allowAfterDayClose: options.allowAfterDayClose ?? false,
      ignoreStopRequested: options.ignoreStopRequested })
  return new Set(rows.map(pendingPersonId).filter(Boolean))
}

async function confirmSent(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  item: ConnectionHistoryItem, status: 'sent' | 'accepted' = 'sent') {
  item.status = status; item.reasonCode = status === 'accepted'
    ? 'connection_accepted' : 'pending_readback_confirmed'
  item.verifiedAt = runtime.now().toISOString(); await updateHistory(runtime, run, save, item)
  run.counters.sent += 1
  run.counters.sentByAudience[item.audience] += 1
  run.counters.filterFunnel[item.audience].sent += 1
  run.stage = 'sending'; await save(run, 'invitation_sent')
  runtime.logger.event('invitation_readback', 'succeeded', { runId: run.runId,
    platformAccountId: run.platformAccountId, audience: item.audience,
    sentCount: run.counters.sent, reasonCode: item.reasonCode })
}

async function resolveUncertain(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  item: ConnectionHistoryItem) {
  run.status = 'running'; run.stage = 'resolving_uncertain'
  await save(run, 'uncertain', 'critical')
  while (true) {
    const pending = await pendingIds(runtime, run, save, { allowAfterDayClose: true })
    if (pending.has(item.personId)) { await confirmSent(runtime, run, save, item); return true }
    const profile = await withConnectionRetry(runtime, run, save, 'unipile',
      'candidate_profile_readback', () => runtime.adapter().getProfile(run.accountId, item.personId),
      { allowAfterDayClose: true })
    if (profileIsConnected(profile)) { await confirmSent(runtime, run, save, item); return true }
    const synthetic = connectionError('unipile_readback_pending',
      'Invitation result is not visible yet.', { httpStatus: 503 })
    run.retryState = makeRetryState(runtime, run, 'unipile', 'invitation_result_readback', synthetic)
    run.stage = 'resolving_uncertain'; run.nextActionAt = run.retryState.nextRetryAt
    run.timerState = { kind: 'overload_backoff', delayMs: run.retryState.delayMs,
      nextActionAt: run.retryState.nextRetryAt }
    await save(run, 'retry_scheduled', 'critical')
    if (!await waitOrStop(runtime, run.runId, run.retryState.delayMs)) return false
  }
}

async function handlePrePostAbort(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  item: ConnectionHistoryItem, error: unknown): Promise<false> {
  const errorCode = connectionErrorCode(error)
  if (!['connection_stop_requested', 'connection_daily_window_closed'].includes(errorCode)) throw error
  await releaseClaimWithoutPost(runtime, run, save, item, errorCode)
  if (errorCode === 'connection_daily_window_closed') throw error
  return false
}

async function sendWithSafety(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  item: ConnectionHistoryItem) {
  let providerAttempted = false
  while (true) {
    runtime.logger.event('invitation_write', 'started', { runId: run.runId,
      platformAccountId: run.platformAccountId, audience: item.audience })
    if (runtime.stopRequested(run.runId)) {
      await releaseClaimWithoutPost(runtime, run, save, item, 'connection_stop_requested')
      return false
    }
    try { requireConnectionRunDay(runtime, run) }
    catch (error) {
      await releaseClaimWithoutPost(runtime, run, save, item,
        'connection_daily_window_closed')
      throw error
    }
    let finalPending: Set<string>
    try {
      finalPending = await pendingIds(runtime, run, save, { allowAfterDayClose: false })
    } catch (error) { return handlePrePostAbort(runtime, run, save, item, error) }
    if (finalPending.has(item.personId)) {
      if (providerAttempted) {
        await confirmSent(runtime, run, save, item); return true
      }
      await releaseClaimWithoutPost(runtime, run, save, item,
        'pending_invitation_pre_send', 'pending')
      countSkip(runtime, run, item, 'pending_invitation')
      return false
    }
    if (runtime.stopRequested(run.runId)) {
      await releaseClaimWithoutPost(runtime, run, save, item, 'connection_stop_requested')
      return false
    }
    let finalProfile: any
    try {
      finalProfile = await withConnectionRetry(runtime, run, save, 'unipile',
        'candidate_profile_after_claim', () => runtime.adapter()
          .getProfile(run.accountId, item.personId))
    } catch (error) { return handlePrePostAbort(runtime, run, save, item, error) }
    if (profileIsConnected(finalProfile)) {
      if (providerAttempted) {
        await confirmSent(runtime, run, save, item, 'accepted'); return true
      }
      await releaseClaimWithoutPost(runtime, run, save, item,
        'existing_relation_pre_send', 'failed')
      countSkip(runtime, run, item, 'existing_relation')
      return false
    }
    if (runtime.stopRequested(run.runId)) {
      await releaseClaimWithoutPost(runtime, run, save, item, 'connection_stop_requested')
      return false
    }
    try { requireConnectionRunDay(runtime, run) }
    catch (error) {
      await releaseClaimWithoutPost(runtime, run, save, item,
        'connection_daily_window_closed')
      throw error
    }
    const finalPreflight = profileAllowsInvitation(finalProfile)
    if (!finalPreflight.allowed) {
      await releaseClaimWithoutPost(runtime, run, save, item,
        finalPreflight.reasonCode, 'failed')
      countSkip(runtime, run, item, finalPreflight.reasonCode)
      return false
    }
    runtime.assertWriterOwnership?.()
    let response: any
    try {
      providerAttempted = true
      response = await runtime.adapter().sendInvitation(run.accountId, item.personId)
    } catch (error) {
      const status = connectionHttpStatus(error)
      const errorCode = connectionErrorCode(error)
      if (status === 429) {
        if ((await pendingIds(runtime, run, save, { allowAfterDayClose: true })).has(item.personId)) {
          await confirmSent(runtime, run, save, item); return true
        }
        item.status = 'deferred'; item.reasonCode = errorCode
        item.updatedAt = runtime.now().toISOString(); await updateHistory(runtime, run, save, item)
        run.retryState = makeRetryState(runtime, run, 'unipile', 'invitation_write', error)
        run.stage = 'waiting_retry'; run.nextActionAt = run.retryState.nextRetryAt
        run.timerState = { kind: 'overload_backoff', delayMs: run.retryState.delayMs,
          nextActionAt: run.retryState.nextRetryAt }
        await save(run, 'retry_scheduled', 'critical')
        if (!await waitOrStop(runtime, run.runId, run.retryState.delayMs, run.localDate)) return false
        const refreshedPending = await pendingIds(runtime, run, save,
          { allowAfterDayClose: true })
        if (refreshedPending.has(item.personId)) {
          await confirmSent(runtime, run, save, item); return true
        }
        const refreshedProfile = await withConnectionRetry(runtime, run, save, 'unipile',
          'candidate_profile_pre_retry', () => runtime.adapter()
            .getProfile(run.accountId, item.personId))
        if (profileIsConnected(refreshedProfile)) {
          await confirmSent(runtime, run, save, item, 'accepted'); return true
        }
        const retryPreflight = profileAllowsInvitation(refreshedProfile)
        if (!retryPreflight.allowed) {
          item.status = 'failed'; item.reasonCode = retryPreflight.reasonCode
          item.updatedAt = runtime.now().toISOString(); await updateHistory(runtime, run, save, item)
          countSkip(runtime, run, item, retryPreflight.reasonCode); return false
        }
        item.status = 'sending'; item.reasonCode = 'invitation_claimed'
        item.updatedAt = runtime.now().toISOString()
        const reclaimed = await claim(runtime, run, save, item)
        if (!reclaimed) {
          countSkip(runtime, run, item, 'invitation_claim_not_confirmed')
          return false
        }
        item = reclaimed
        continue
      }
      if (isUnknownWrite(error) || (status !== undefined && status >= 500)) {
        item.status = 'uncertain'; item.reasonCode = errorCode
        item.sentAt = runtime.now().toISOString(); item.updatedAt = item.sentAt
        await updateHistory(runtime, run, save, item)
        runtime.logger.event('invitation_write', 'failed', { runId: run.runId,
          platformAccountId: run.platformAccountId, audience: item.audience,
          errorCode, itemStatus: item.status })
        return resolveUncertain(runtime, run, save, item)
      }
      if (status !== undefined && status >= 400 && status < 500) {
        item.status = 'failed'; item.reasonCode = errorCode
        item.updatedAt = runtime.now().toISOString(); await updateHistory(runtime, run, save, item)
        countSkip(runtime, run, item, errorCode); return false
      }
      throw error
    }

    // From this point the POST returned 2xx. No error from Noco persistence or provider
    // read-back is allowed to flow back into the POST retry branch above.
    item.requestId = invitationRequestId(response); item.sentAt = runtime.now().toISOString()
    item.updatedAt = item.sentAt; item.status = 'uncertain'
    item.reasonCode = 'invitation_readback_pending'
    run.stage = 'readback_pending'; await save(run, 'stage_changed')
    runtime.logger.event('invitation_write', 'succeeded', { runId: run.runId,
      platformAccountId: run.platformAccountId, audience: item.audience,
      itemStatus: item.status, reasonCode: item.reasonCode })
    if ((await pendingIds(runtime, run, save,
      { allowAfterDayClose: true })).has(item.personId)) {
      await confirmSent(runtime, run, save, item); return true
    }
    item.reasonCode = 'connection_invitation_readback_missing'
    await updateHistory(runtime, run, save, item)
    return resolveUncertain(runtime, run, save, item)
  }
}

export async function createInvitationPublisher(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun) {
  const details = { runId: run.runId, platformAccountId: run.platformAccountId }
  let pending = await pendingIds(runtime, run, save)
  let sentAny = run.counters.sent > 0
  return {
    async publish(audience: SearchAudience, candidates: ConnectionHistoryItem[], sentLimit = 1) {
      runtime.logger.event('invitation_publish', 'started', { ...details, audience, sentLimit })
      const processedPersonIds: string[] = []; let sentCount = 0
      try {
        for (const candidate of candidates) {
          if (sentCount >= sentLimit || runtime.stopRequested(run.runId)) break
          requireConnectionRunDay(runtime, run)
          if (pending.has(candidate.personId)) {
            countSkip(runtime, run, candidate, 'pending_invitation')
            processedPersonIds.push(candidate.personId); continue
          }
          if (sentAny) {
            const delayMs = sendDelay(runtime.random)
            runtime.logger.event('invitation_delay', 'succeeded', { ...details, delayMs })
            if (!await waitWithRunTimer(runtime, run, save, 'invitation_delay',
              'invitation_delay', delayMs, true)) break
          }
          if (runtime.stopRequested(run.runId)) break
          requireConnectionRunDay(runtime, run)
          pending = await pendingIds(runtime, run, save)
          if (pending.has(candidate.personId)) {
            countSkip(runtime, run, candidate, 'pending_invitation')
            processedPersonIds.push(candidate.personId); continue
          }
          const finalProfile = await withConnectionRetry(runtime, run, save, 'unipile',
            'candidate_profile_pre_send', () => runtime.adapter()
              .getProfile(run.accountId, candidate.personId))
          const finalPreflight = profileAllowsInvitation(finalProfile)
          if (!finalPreflight.allowed) {
            countSkip(runtime, run, candidate, finalPreflight.reasonCode)
            processedPersonIds.push(candidate.personId); continue
          }
          run.counters.filterFunnel[audience].preflightPassed += 1
          runtime.logger.event('candidate_preflight', 'succeeded', { ...details, audience,
            reasonCode: finalPreflight.reasonCode })
          candidate.status = 'sending'; candidate.reasonCode = 'invitation_claimed'
          candidate.updatedAt = runtime.now().toISOString()
          const item = await claim(runtime, run, save, candidate)
          if (!item) {
            countSkip(runtime, run, candidate, 'lifetime_history_block')
            processedPersonIds.push(candidate.personId); continue
          }
          run.counters.filterFunnel[audience].claimed += 1
          run.stage = 'sending'; await save(run, 'stage_changed')
          runtime.logger.event('invitation_claim', 'succeeded', { ...details, audience })
          const sent = await sendWithSafety(runtime, run, save, item)
          processedPersonIds.push(candidate.personId)
          if (sent) {
            sentCount += 1; sentAny = true; pending.add(item.personId)
          }
        }
        runtime.logger.event('invitation_publish', 'succeeded', { ...details, audience,
          sentCount: run.counters.sent })
        return { processedPersonIds, sentCount }
      } catch (error) {
        runtime.logger.event('invitation_publish', 'failed', { ...details, audience,
          errorCode: connectionErrorCode(error) }); throw error
      }
    }
  }
}
