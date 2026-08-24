import { observeSteps, type Observation } from './observe.ts'
import { profileErrorDetails } from './errors.ts'
import type { ProfileLogger } from './profile-logger.ts'
import type { FillResult, FillStepResult, ProfileClient, ProfilePlan } from './plan-types.ts'
import { scheduledAt } from './progress-state.ts'
import { delayMilliseconds, type DelayRange } from './timing.ts'

type Update = { index: number; patch: Partial<FillStepResult> }

export async function verifyDelayed(options: {
  client: ProfileClient
  plan: ProfilePlan
  result: FillResult
  attempts: number
  range: DelayRange
  wait(milliseconds: number): Promise<void>
  progress(updates: Update[]): Promise<void>
  logger: ProfileLogger
  clock(): number
  random?: (minimum: number, maximumExclusive: number) => number
  onStage?(stage: string): void
}) {
  const { client, plan, result, attempts, range, wait, progress, logger, clock, random, onStage } = options
  let delayed = result.steps.map((step, index) => ({ step, index }))
    .filter(item => item.step.status === 'verification_delayed')
  for (let attempt = 1; delayed.length && attempt <= attempts; attempt += 1) {
    const pause = delayMilliseconds(range, random)
    const nextActionAt = scheduledAt(pause, clock)
    onStage?.(`final_verification:${attempt}/${attempts}`)
    await progress(delayed.map(({ index }) => ({ index, patch: {
      status: 'verifying', attempt, maxAttempts: attempts, nextActionAt,
      message: `Final read-only verification (${attempt}/${attempts}).`
    } })))
    logger.event('final_verification_wait', 'started', { attempt, maxAttempts: attempts,
      durationMs: pause, stepCount: delayed.length })
    await wait(pause)
    logger.event('final_verification_wait', 'succeeded', { attempt, maxAttempts: attempts,
      durationMs: pause, stepCount: delayed.length })
    let observations: Array<Observation | undefined>
    logger.event('final_verification_read', 'started', { attempt, maxAttempts: attempts,
      stepCount: delayed.length })
    try {
      observations = await observeSteps(client, plan.account.accountId,
        delayed.map(({ index }) => plan.steps[index]))
      logger.event('final_verification_read', 'succeeded', { attempt, maxAttempts: attempts,
        stepCount: delayed.length })
    } catch (error) {
      observations = delayed.map(() => undefined)
      logger.event('final_verification_read', 'failed', { attempt, maxAttempts: attempts,
        stepCount: delayed.length, ...profileErrorDetails(error) })
    }
    await progress(delayed.map(({ index }, position) => {
      const observation = observations[position]
      logger.event('final_verification_check', observation ? 'succeeded' : 'failed', {
        stepId: plan.steps[index].id, section: plan.steps[index].section,
        attempt, maxAttempts: attempts, observation: observation ?? 'unavailable'
      })
      return observation === 'matched' ? { index, patch: {
        status: 'verified', failureKind: undefined, message: 'Verified in final read-only check.'
      } } : { index, patch: {
        status: 'verification_delayed',
        failureKind: observation === 'mismatch' ? 'value_mismatch' : result.steps[index].failureKind,
        message: observation === 'mismatch' ? 'LinkedIn still returns a different value.' :
          'LinkedIn verification is still delayed.'
      } }
    }))
    delayed = result.steps.map((step, index) => ({ step, index }))
      .filter(item => item.step.status === 'verification_delayed')
  }
  return delayed.length
}
