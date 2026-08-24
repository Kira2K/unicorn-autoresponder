import { profileErrorCode } from './errors.ts'
import type { Observation } from './observe.ts'

export function failureKind(writeError: unknown, observation?: Observation) {
  if (!writeError) return observation === 'mismatch' ? 'value_mismatch' : 'write_accepted_not_visible'
  const code = profileErrorCode(writeError)
  return ['unipile_timeout', 'unipile_unreachable'].includes(code) ? 'write_uncertain' : 'write_rejected'
}

export const failureCode = (error: unknown) => profileErrorCode(error)

export function delayedMessage(kind: string) {
  return kind === 'value_mismatch'
    ? 'LinkedIn returned a different value; final check pending.'
    : 'Write result will be checked again after all writes.'
}

export function rejectedMessage() {
  return 'Write was rejected and the value was not verified.'
}
