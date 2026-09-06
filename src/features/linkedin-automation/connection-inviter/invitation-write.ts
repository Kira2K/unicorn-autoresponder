import { connectionErrorCode, connectionHttpStatus,
  normalizeConnectionProviderError } from './errors.ts'
import type { InvitationSafetyContext } from './invitation-context.ts'
import { prepareInvitation } from './invitation-profile.ts'
import { readBackSuccessfulPost, resolveInvitationResult } from './invitation-readback.ts'
import { recoverInvitationRateLimit } from './invitation-rate-limit.ts'
import { requireConnectionRunDay } from './day-window.ts'
import { isUnknownWrite } from './run-model.ts'
import type { ConnectionHistoryItem } from './types.ts'

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
    item.status = 'uncertain'; item.reasonCode = errorCode
    item.sentAt = item.sentAt ?? runtime.now().toISOString(); item.updatedAt = item.sentAt
    await history.update(item)
    runtime.logger.event('invitation_write', 'failed', {
      runId: run.runId, platformAccountId: run.platformAccountId,
      audience: item.audience, errorCode, itemStatus: item.status
    })
    return { retry: false as const, sent: await resolveInvitationResult(context, item) }
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
    runtime.assertWriterOwnership?.()
    runtime.logger.event('invitation_write', 'started', {
      runId: run.runId, platformAccountId: run.platformAccountId, audience: item.audience
    })
    let response: unknown
    try { response = await runtime.adapter().sendInvitation(run.accountId, item.personId) }
    catch (caught) {
      const error = normalizeConnectionProviderError('unipile', caught)
      const result = await handleWriteFailure(context, item, error)
      if (!result.retry) return result.sent
      item = result.item; needsPreflight = false
      continue
    }
    return readBackSuccessfulPost(context, item, response)
  }
}
