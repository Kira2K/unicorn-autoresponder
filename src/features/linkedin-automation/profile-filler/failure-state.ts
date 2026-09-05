import { profileErrorCode } from './errors.ts'
import type { Observation } from './observe.ts'

export function failureKind(writeError: unknown, observation?: Observation) {
  if (!writeError) return observation === 'mismatch' ? 'value_mismatch' : 'write_accepted_not_visible'
  const code = profileErrorCode(writeError)
  if (code.startsWith('profile_')) return 'prewrite_blocked'
  const status = Number((writeError as { details?: { httpStatus?: unknown } } | undefined)?.details?.httpStatus)
  return ['unipile_timeout', 'unipile_unreachable'].includes(code) || status >= 500
    ? 'write_uncertain' : 'write_rejected'
}

export const failureCode = (error: unknown) => profileErrorCode(error)

export function delayedMessage(kind: string) {
  return kind === 'value_mismatch'
    ? 'LinkedIn returned a different value; final check pending.'
    : 'Write result is not confirmed; another read-only check is required.'
}

export function rejectedMessage(kind = 'write_rejected') {
  return kind === 'prewrite_blocked'
    ? 'Write was blocked because the approved state could not be confirmed safely.'
    : 'Write was rejected and the value was not verified.'
}
