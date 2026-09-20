import type { Candidate, Invitation, Run } from './contracts.ts'
import { retryAfterMilliseconds, unipileRateLimitDelay } from '../connection-inviter/retry-state.ts'
const DAY = 86_400_000
export const WITHDRAWAL_AGE_MS = 14 * DAY
export function classifyInvitations(items: Invitation[], now: number, attempted: string[]): Candidate[] {
  const blocked = new Set(attempted)
  return items.map(item => {
    const raw = item.createdAt ?? ''
    const timestamp = Date.parse(raw)
    const valid = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(raw) &&
      Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19) === raw.slice(0, 19) && timestamp <= now
    const reason = blocked.has(item.id) ? 'already_attempted' : !valid ? 'date_unknown' :
      now - timestamp <= WITHDRAWAL_AGE_MS ? 'too_recent' : undefined
    return { ...item, ageDays: valid ? Math.floor((now - timestamp) / DAY) : undefined,
      eligible: !reason, ...(reason ? { reason } : {}) }
  })
}
export function withdrawalDelay(random: () => number) {
  const value = random()
  return 2000 + Math.floor((Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1) * 11000)
}
export function withdrawalError(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}
export function withdrawalNeedsCheck(run?: Run) {
  return Boolean(run && ['uncertain', 'interrupted', 'running'].includes(run.status))
}
export function withdrawalRetryAt(error: any, now: number, attempt = 1) {
  const limited = error?.details?.httpStatus === 429 ||
    /^unipile_.*(?:429|too_many_requests|rate_limit)/.test(String(error?.code ?? ''))
  return limited ? now + unipileRateLimitDelay(attempt, () => 0, retryAfterMilliseconds(error)) : undefined
}
