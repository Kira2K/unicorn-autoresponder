import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import { retryAfterMilliseconds } from './retry-state.ts'
import { recordFailure, recoveryExpired, recoveryWakeAt, skipRecovery, ACTION_SKIPPED } from '../action-recovery.ts'

export function recordInvitationFailure(run: ConnectionRun, items: ConnectionHistoryItem[], error: unknown, now: number) {
  const recovery = run.searchProgress.actionRecovery ??= {}
  for (const item of items) {
    const key = `invite:${item.personId}`, value = recordFailure(recovery[key], error, now)
    if (value) recovery[key] = value
  }
}

export async function expireInvitationRecovery(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  items: ConnectionHistoryItem[]) {
  let changed = false
  for (const item of items) {
    const value = run.searchProgress.actionRecovery?.[`invite:${item.personId}`]
    if (!['sending', 'uncertain'].includes(item.status) ||
      !recoveryExpired(value, runtime.now().getTime())) continue
    if (item.reasonCode === ACTION_SKIPPED && value?.skippedAt !== undefined) continue
    // Status and reservation remain unknown; only automatic polling stops.
    item.status = 'uncertain'; item.reasonCode = ACTION_SKIPPED
    await runtime.store.updateHistory(item)
    skipRecovery(value!, runtime.now().getTime()); changed = true
    runtime.logger.event('action_skipped', 'failed', { runId: run.runId, personId: item.personId,
      reasonCode: ACTION_SKIPPED, message: 'Приглашение не подтверждено за 20 минут. Повторной отправки не будет.' })
  }
  if (changed) { clearInvitationVerification(run); await save(run, 'progress', 'critical') }
}

// One read-back pass per deadline. Network retries cannot reset this durable budget.
export async function beginInvitationVerification(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun, items: ConnectionHistoryItem[]) {
  const now = runtime.now().getTime()
  const previous = run.searchProgress.invitationVerification
  const personIds = [...new Set([...(previous?.accountId === run.accountId ? previous.personIds ?? [] : []),
    ...items.map(item => item.personId)])]
  if (previous?.accountId === run.accountId && Date.parse(previous.nextCheckAt) > now) {
    previous.personIds = personIds
    await deferInvitationVerification(runtime, run, save)
    return false
  }
  const attempt = previous?.accountId === run.accountId ? previous.attempt + 1 : 1
  const firstAttemptAt = previous?.accountId === run.accountId ? previous.firstAttemptAt :
    new Date(Math.min(now, ...items.map(i => Date.parse(i.sentAt ?? i.updatedAt)).filter(Number.isFinite))).toISOString()
  const elapsed = now - Date.parse(firstAttemptAt)
  const minutes = elapsed >= 2 * 3600_000 ? 120 : [15, 30, 60, 120][Math.min(3, attempt - 1)]
  run.searchProgress.invitationVerification = { accountId: run.accountId, firstAttemptAt, attempt, personIds,
    nextCheckAt: new Date(now + minutes * 60_000).toISOString() }
  // Persist before reading: interruption or restart must not start a fresh polling loop.
  await deferInvitationVerification(runtime, run, save)
  return true
}

export async function deferInvitationVerification(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun, error?: unknown) {
  const state = run.searchProgress.invitationVerification!
  const now = runtime.now().getTime()
  const providerWait = retryAfterMilliseconds(error, now)
  let next = Math.max(Date.parse(state.nextCheckAt), providerWait === undefined ? 0 : now + providerWait)
  for (const id of state.personIds ?? []) next = recoveryWakeAt(run.searchProgress.actionRecovery?.[`invite:${id}`], next)
  state.nextCheckAt = new Date(next).toISOString()
  if (error) state.blockedUntil = state.nextCheckAt
  run.status = 'running'; run.stage = 'resolving_uncertain'; run.finishedAt = undefined
  run.errorCode = 'connection_invitation_result_pending'; run.nextActionAt = state.nextCheckAt
  run.timerState = { kind: 'overload_backoff', delayMs: Math.max(0, next - now), nextActionAt: state.nextCheckAt }
  await save(run, 'retry_scheduled', 'critical')
}

export function clearInvitationVerification(run: ConnectionRun) {
  run.searchProgress.invitationVerification = undefined
  clearVerificationWait(run)
}

export function clearVerificationWait(run: ConnectionRun) {
  if (run.errorCode === 'connection_invitation_result_pending') {
    run.errorCode = undefined; run.nextActionAt = undefined; run.timerState = undefined; run.retryState = undefined
  }
}
