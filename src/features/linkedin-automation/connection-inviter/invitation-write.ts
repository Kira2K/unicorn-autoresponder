import { connectionError, connectionErrorCode, connectionHttpStatus,
  normalizeConnectionProviderError } from './errors.ts'
import type { InvitationSafetyContext } from './invitation-context.ts'
import { prepareInvitation } from './invitation-profile.ts'
import { readBackSuccessfulPost, resolveInvitationResult } from './invitation-readback.ts'
import { recoverInvitationRateLimit } from './invitation-rate-limit.ts'
import { requireConnectionRunDay } from './day-window.ts'
import { isUnknownWrite } from './run-model.ts'
import type { ConnectionHistoryItem } from './types.ts'
import { withConnectionRequestAttempt } from './logger.ts'
import { deferInvitationVerification, recordInvitationFailure } from './invitation-verification.ts'

async function stopOrCloseBeforePost(context: InvitationSafetyContext,
  item: ConnectionHistoryItem) {
  const { runtime, run, history } = context
  if (runtime.stopRequested(run.runId)) {
    await history.release(item, 'connection_stop_requested')
    return true
  }
  try { requireConnectionRunDay(runtime, run); return false }
  catch (error) {
    await history.release(item, 'connection_daily_window_closed')
    throw error
  }
}

async function handleWriteFailure(context: InvitationSafetyContext,
  item: ConnectionHistoryItem, error: unknown) {
  const { runtime, run, history, pending } = context
  const status = connectionHttpStatus(error)
  const errorCode = connectionErrorCode(error)
  pending.invalidate(errorCode)
  if (status === 429) return recoverInvitationRateLimit(context, item, error)
  if (isUnknownWrite(error) || (status !== undefined && status >= 500)) {
    recordInvitationFailure(run, [item], error, runtime.now().getTime())
    item.status = 'uncertain'; item.reasonCode = errorCode
    item.sentAt = item.sentAt ?? runtime.now().toISOString(); item.updatedAt = item.sentAt
    await history.update(item)
    await context.save(run, 'progress', 'critical')
    runtime.logger.event('invitation_write', 'failed', {
      runId: run.runId, platformAccountId: run.platformAccountId,
      audience: item.audience, errorCode, itemStatus: item.status
    })
    const sent = await resolveInvitationResult(context, item)
    // An unhealthy send endpoint pauses new writes too, even if read-back itself succeeded.
    if (!sent && run.searchProgress.invitationVerification)
      await deferInvitationVerification(runtime, run, context.save, error)
    return { retry: false as const, sent }
  }
  if (status !== undefined && status >= 400 && status < 500) {
    item.status = 'failed'; item.reasonCode = errorCode
    item.updatedAt = runtime.now().toISOString(); await history.update(item)
    history.countSkip(item, errorCode)
    return { retry: false as const, sent: false }
  }
  throw error
}

export async function sendInvitationSafely(context: InvitationSafetyContext,
  initialItem: ConnectionHistoryItem) {
  const { runtime, run } = context
  let item = initialItem
  let needsPreflight = true
  while (true) {
    if (needsPreflight) {
      const preflight = await prepareInvitation(context, item)
      if (!preflight.ready) return preflight.sent
    }
    if (await stopOrCloseBeforePost(context, item)) return false
    // A real write attempt consumes the pause; a rejected candidate does not.
    // An unresolved claim forces a new pause on recovery; no extra storage write per POST.
    run.searchProgress.invitationPacingStarted = true
    run.searchProgress.invitationPauseAfterPersonId = item.personId
    run.searchProgress.invitationNotBefore = undefined
    runtime.assertWriterOwnership?.()
    runtime.logger.event('invitation_write', 'started', {
      runId: run.runId, platformAccountId: run.platformAccountId, audience: item.audience
    })
    let response: unknown
    try {
      response = await withConnectionRequestAttempt((run.invitationRetryState?.attempt ?? 0) + 1,
        () => runtime.adapter().sendInvitation(run.accountId, item.personId))
    }
    catch (caught) {
      if ((caught as any)?.notSent === true) {
        await context.history.release(item, connectionErrorCode(caught))
        run.nextActionAt = new Date(Math.max(runtime.now().getTime() + 30_000,
          Number((caught as any)?.details?.retryAt) || 0)).toISOString()
        await context.save(run, 'retry_scheduled', 'critical')
        if (runtime.cooperative) throw connectionError('connection_step_yield', 'Запрос не отправлен; ожидание сохранено.')
        throw caught
      }
      const error = normalizeConnectionProviderError('unipile', caught)
      const result = await handleWriteFailure(context, item, error)
      if (!result.retry) return result.sent
      item = result.item; needsPreflight = false
      continue
    }
    return readBackSuccessfulPost(context, item, response)
  }
}
