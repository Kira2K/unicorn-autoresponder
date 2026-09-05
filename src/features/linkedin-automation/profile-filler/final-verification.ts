import { observeSteps, type Observation } from './observe.ts'
import { profileErrorDetails } from './errors.ts'
import type { ProfileLogger } from './profile-logger.ts'
import type { FillResult, FillStepResult, ProfileClient, ProfilePlan } from './plan-types.ts'
import { scheduledAt } from './progress-state.ts'
import { delayMilliseconds, type DelayRange } from './timing.ts'
import { providerDelayMs } from './provider-delay.ts'

type Update = { index: number; patch: Partial<FillStepResult> }

function verificationSchedule(range: DelayRange, configured?: number[],
  random?: (minimum: number, maximumExclusive: number) => number) {
  return configured?.length ? configured.map(seconds => Math.max(0, seconds * 1_000)) :
    [delayMilliseconds(range, random)]
}

function failurePatch(step: FillStepResult, observation: Observation | undefined, final: boolean) {
  const failureKind = step.failureKind === 'write_uncertain' ? 'write_uncertain' as const :
    observation === 'mismatch' ? 'value_mismatch' as const : 'write_accepted_not_visible' as const
  if (final) return {
    status: 'failed' as const, failureKind,
    errorCode: step.errorCode ?? (observation === 'unavailable' || observation === undefined
      ? 'profile_verification_unavailable' : 'profile_verification_mismatch'),
    message: failureKind === 'write_uncertain'
      ? 'The write result remains uncertain after the final read-only check.'
      : observation === 'mismatch'
      ? 'LinkedIn still returns a different value after the final check.'
      : 'LinkedIn did not return this value after the final check.'
  }
  return { status: 'verification_delayed' as const, failureKind,
    message: failureKind === 'write_uncertain'
      ? 'The write result is uncertain; another read-only check is scheduled.'
      : observation === 'mismatch'
      ? 'LinkedIn still returns a different value; another read-only check is scheduled.'
      : 'LinkedIn has not returned this value yet; another read-only check is scheduled.' }
}

export async function verifyFinal(options: {
  client: ProfileClient
  plan: ProfilePlan
  result: FillResult
  range: DelayRange
  scheduleSeconds?: number[]
  wait(milliseconds: number): Promise<void>
  progress(updates: Update[]): Promise<void>
  logger: ProfileLogger
  clock(): number
  random?: (minimum: number, maximumExclusive: number) => number
  recheckVerified?: boolean
  onStage?(stage: string): void
}) {
  const { client, plan, result, range, wait, progress, logger, clock, onStage } = options
  const schedule = verificationSchedule(range, options.scheduleSeconds, options.random)
  const previous = result.verification
  const startedAt = previous?.startedAt ?? new Date(previous?.nextReadBackAt
    ? Date.parse(previous.nextReadBackAt) - schedule[Math.max(0, previous.attempt - 1)] : clock()).toISOString()
  let position = result.verification?.nextReadBackAt
    ? Math.max(0, result.verification.attempt - 1) : result.verification?.attempt ?? 0
  while (position < schedule.length) {
    const checked = result.steps.map((step, index) => ({ step, index }))
      .filter(({ step }) => !['pending', 'waiting', 'pending_retry', 'failed'].includes(step.status) &&
        (position === 0 && options.recheckVerified || step.status !== 'verified'))
    if (!checked.length) break
    const attempt = position + 1
    const savedAt = result.verification?.attempt === attempt
      ? result.verification.nextReadBackAt : undefined
    const scheduled = savedAt ? Date.parse(savedAt) : Date.parse(startedAt) + schedule[position]
    const retryAt = Date.parse(result.verification?.notBefore ?? '') || 0
    const intentWait = Math.max(0, ...checked.map(({ step }) => Date.parse(step.nextActionAt ?? '') || 0))
    const pause = Math.max(0, Math.max(scheduled, retryAt, intentWait) - clock())
    const nextReadBackAt = scheduledAt(pause, clock)
    result.status = 'verifying'
    result.verification = { ...result.verification, startedAt, attempt, maxAttempts: schedule.length, nextReadBackAt }
    onStage?.(`final_verification:${attempt}/${schedule.length}`)
    await progress(checked.map(({ index }) => ({ index, patch: {
      status: 'verifying', attempt, maxAttempts: schedule.length, nextActionAt: nextReadBackAt,
      message: `Read-only verification (${attempt}/${schedule.length}).`
    } })))
    logger.event('final_verification_wait', 'started', { attempt, maxAttempts: schedule.length,
      durationMs: pause, stepCount: checked.length })
    await wait(pause)
    logger.event('final_verification_wait', 'succeeded', { attempt, maxAttempts: schedule.length,
      durationMs: pause, stepCount: checked.length })
    let observations: Array<Observation | undefined>
    logger.event('final_verification_read', 'started', { attempt, maxAttempts: schedule.length,
      stepCount: checked.length })
    try {
      observations = await observeSteps(client, plan.account.accountId,
        checked.map(({ step, index }) => step.writeIntent?.step ?? plan.steps[index]))
      logger.event('final_verification_read', 'succeeded', { attempt,
        maxAttempts: schedule.length, stepCount: checked.length })
    } catch (error) {
      const delay = providerDelayMs(error)
      if (delay) result.verification.notBefore = scheduledAt(delay, clock)
      observations = checked.map(() => undefined)
      logger.event('final_verification_read', 'failed', { attempt,
        maxAttempts: schedule.length, stepCount: checked.length, ...profileErrorDetails(error) })
    }
    result.verification = { ...result.verification, attempt, maxAttempts: schedule.length, nextReadBackAt: undefined }
    const final = attempt === schedule.length
    await progress(checked.map(({ index }, offset) => {
      const observation = observations[offset]
      logger.event('final_verification_check', observation === 'matched' ? 'succeeded' : 'failed', {
        stepId: plan.steps[index].id, section: plan.steps[index].section,
        attempt, maxAttempts: schedule.length, observation: observation ?? 'unavailable'
      })
      return observation === 'matched' ? { index, patch: {
        status: 'verified', failureKind: undefined, errorCode: undefined,
        message: 'Verified in LinkedIn.'
      } } : { index, patch: failurePatch(result.steps[index], observation, final) }
    }))
    position += 1
  }
  return result.steps.filter(step => step.status !== 'verified').length
}
