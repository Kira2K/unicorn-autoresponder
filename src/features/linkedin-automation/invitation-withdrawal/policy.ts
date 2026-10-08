import type { Account, Candidate, Invitation, Run } from './contracts.ts'
import { retryAfterMilliseconds, unipileRateLimitDelay } from '../connection-inviter/retry-state.ts'
import { providerRetryAt } from '../../../integrations/unipile/retry-after.ts'
import { retryableUnipileRead } from '../../../integrations/unipile/read-retry.ts'
const DAY = 86_400_000
export const WITHDRAWAL_AGE_MS = 14 * DAY
export function sameWithdrawalAccount(left: Account, right: Account) {
  return left.platformAccountId === right.platformAccountId && left.accountId === right.accountId &&
    left.linkedinUrl === right.linkedinUrl && left.verifiedProviderId === right.verifiedProviderId
}
export function classifyInvitations(items: Invitation[], now: number, attempted: string[], protectedSince?: number): Candidate[] {
  const blocked = new Set(attempted)
  return items.map(item => {
    const raw = item.createdAt ?? ''
    const timestamp = Date.parse(raw)
    const valid = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(raw) &&
      Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19) === raw.slice(0, 19) && timestamp <= now
    const reason = blocked.has(item.id) ? 'already_attempted' : !valid ? 'date_unknown' :
      now - timestamp <= WITHDRAWAL_AGE_MS ? 'too_recent' :
      protectedSince !== undefined && timestamp >= protectedSince ? 'invitation_result_pending' : undefined
    return { ...item, ageDays: valid ? Math.floor((now - timestamp) / DAY) : undefined,
      eligible: !reason, ...(reason ? { reason } : {}) }
  })
}
export function withdrawalDelay(random: () => number) {
  const value = random()
  return 5000 + Math.floor((Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1) * 10000)
}
export function withdrawalError(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}
export function assertApprovedQueue(run: Run) {
  if (run.targets === undefined) return // Legacy state may be reconciled, never continued.
  const valid = Array.isArray(run.targets) && run.targets.length === run.total &&
    Number.isSafeInteger(run.cursor) && run.cursor! >= 0 && run.cursor! <= run.total &&
    run.cursor === run.withdrawn + run.skipped + (run.unconfirmed?.length ?? 0) &&
    (!run.unconfirmed || (new Set(run.unconfirmed).size === run.unconfirmed.length &&
      run.unconfirmed.every(id => run.targets!.slice(0, run.cursor).some(item => item.id === id) &&
        !run.confirmed?.includes(id) && !run.noLongerPending?.includes(id)))) &&
    new Set(run.targets.map(item => item.id)).size === run.targets.length &&
    run.targets.every(item => typeof item.id === 'string' && item.id && item.eligible === true) &&
    run.approvedAccount?.accountId === run.accountId &&
    run.approvedAccount.platformAccountId === run.platformAccountId &&
    (!run.current || run.targets[run.cursor!]?.id === run.current)
  if (!valid) throw withdrawalError('withdrawal_journal_invalid', 'Сохранённая очередь повреждена. Отправки запрещены.')
}
export function withdrawalNeedsCheck(run?: Run) {
  return Boolean(run && !run.recoveryClosed && (['uncertain', 'interrupted', 'running'].includes(run.status) ||
    run.current || run.unconfirmed?.length || (run.confirmed?.length && !run.checkedAt)))
}
// An explicit Stop ends execution, not the lifetime protection of its attempted IDs.
export function withdrawalBlocksNewRun(run?: Run) {
  return run?.status !== 'stopped' && !run?.stopRequested && withdrawalNeedsCheck(run)
}
export function withdrawalPendingResults(run: Run) {
  return !run.recoveryClosed && Boolean(run.current ||
    run.unconfirmed?.some(id => run.recovery?.[`cancel:${id}`]?.skippedAt === undefined) ||
    (run.confirmed?.length && !run.checkedAt) || (run.status === 'uncertain' && !run.targets))
}
export function withdrawalRetryAt(error: any, now: number, attempt = 1) {
  const limited = error?.details?.httpStatus === 429 ||
    /^unipile_.*(?:429|too_many_requests|rate_limit)/.test(String(error?.code ?? ''))
  return limited ? providerRetryAt(error, now,
    unipileRateLimitDelay(attempt, () => 0, retryAfterMilliseconds(error, now))) :
    retryableUnipileRead(error) ? providerRetryAt(error, now, Math.min(3600_000, 60_000 * 2 ** Math.min(6, attempt - 1))) : undefined
}
