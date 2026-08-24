import { observeSteps, type Observation } from './observe.ts'
import { profileErrorDetails } from './errors.ts'
import type { ProfileLogger } from './profile-logger.ts'
import type { FillResult, FillStepResult, ProfileClient, ProfilePlan } from './plan-types.ts'
import { scheduledAt } from './progress-state.ts'
import { delayMilliseconds, type DelayRange } from './timing.ts'

type Update = { index: number; patch: Partial<FillStepResult> }

export async function verifyFinal(options: {
  client: ProfileClient
  plan: ProfilePlan
  result: FillResult
  range: DelayRange
  wait(milliseconds: number): Promise<void>
  progress(updates: Update[]): Promise<void>
  logger: ProfileLogger
  clock(): number
  random?: (minimum: number, maximumExclusive: number) => number
  onStage?(stage: string): void
}) {
  const { client, plan, result, range, wait, progress, logger, clock, random, onStage } = options
  const checked = result.steps.map((step, index) => ({ step, index }))
  const pause = delayMilliseconds(range, random)
  const nextActionAt = scheduledAt(pause, clock)
  onStage?.('final_verification:1/1')
  await progress(checked.map(({ index }) => ({ index, patch: {
    status: 'verifying', attempt: 1, maxAttempts: 1, nextActionAt,
    message: 'Final read-only verification (1/1).'
  } })))
  logger.event('final_verification_wait', 'started', { attempt: 1, maxAttempts: 1,
    durationMs: pause, stepCount: checked.length })
  await wait(pause)
  logger.event('final_verification_wait', 'succeeded', { attempt: 1, maxAttempts: 1,
    durationMs: pause, stepCount: checked.length })
  let observations: Array<Observation | undefined>
  logger.event('final_verification_read', 'started', { attempt: 1, maxAttempts: 1,
    stepCount: checked.length })
  try {
    observations = await observeSteps(client, plan.account.accountId,
      checked.map(({ index }) => plan.steps[index]))
    logger.event('final_verification_read', 'succeeded', { attempt: 1, maxAttempts: 1,
      stepCount: checked.length })
  } catch (error) {
    observations = checked.map(() => undefined)
    logger.event('final_verification_read', 'failed', { attempt: 1, maxAttempts: 1,
      stepCount: checked.length, ...profileErrorDetails(error) })
  }
  await progress(checked.map(({ index }, position) => {
    const observation = observations[position]
    logger.event('final_verification_check', observation ? 'succeeded' : 'failed', {
      stepId: plan.steps[index].id, section: plan.steps[index].section,
      attempt: 1, maxAttempts: 1, observation: observation ?? 'unavailable'
    })
    return observation === 'matched' ? { index, patch: {
      status: 'verified', failureKind: undefined, message: 'Verified in final read-only check.'
    } } : { index, patch: {
      status: 'verification_delayed',
      failureKind: observation === 'mismatch' ? 'value_mismatch' :
        result.steps[index].failureKind ?? 'write_accepted_not_visible',
      message: observation === 'mismatch' ? 'LinkedIn still returns a different value.' :
        'LinkedIn verification is still delayed.'
    } }
  }))
  return observations.filter(observation => observation !== 'matched').length
}
