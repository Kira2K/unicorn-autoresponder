import { delayedMessage, failureCode, failureKind, rejectedMessage } from './failure-state.ts'
import { profileErrorDetails } from './errors.ts'
import { verifyFinal } from './final-verification.ts'
import { observeReadBack, type Observation } from './observe.ts'
import { NOOP_PROFILE_LOGGER, type ProfileLogger } from './profile-logger.ts'
import type { FillResult, FillStepResult, ProfileClient, ProfilePlan } from './plan-types.ts'
import { createProgress, finishProgress, scheduledAt, updateProgress } from './progress-state.ts'
import { DEFAULT_TIMING, delayMilliseconds, type TimingPolicy } from './timing.ts'
import { writeStep } from './step-write.ts'
type ExecutorOptions = {
  timing?: TimingPolicy
  wait?: (milliseconds: number) => Promise<void>; clock?: () => number
  random?: (minimum: number, maximumExclusive: number) => number
  onStage?: (stage: string) => void; logger?: ProfileLogger
  onProgress?: (result: FillResult) => void | Promise<void>
}
export async function executeProfilePlan(client: ProfileClient, plan: ProfilePlan,
  options: ExecutorOptions = {}): Promise<FillResult> {
  const logger = options.logger ?? NOOP_PROFILE_LOGGER
  logger.event('run', 'started', { stepCount: plan.steps.length })
  if (!plan.steps.length) {
    logger.event('run', 'succeeded', { stepCount: 0 })
    return { status: 'no_changes', steps: [] }
  }
  const timing = options.timing ?? DEFAULT_TIMING
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const clock = options.clock ?? Date.now
  const result = createProgress(plan, clock)
  const progressMany = async (updates: Array<{ index: number; patch: Partial<FillStepResult> }>) => {
    let snapshot = structuredClone(result)
    updates.forEach(({ index, patch }) => { snapshot = updateProgress(result, index, patch, clock) })
    await options.onProgress?.(snapshot)
  }
  const progress = (index: number, patch: Partial<FillStepResult>) => progressMany([{ index, patch }])
  await options.onProgress?.(structuredClone(result))
  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index]
    const previous = plan.steps[index - 1]
    const range = index === 0 ? timing.firstWrite :
      step.section === 'skills' && previous?.section === 'skills' ? timing.skillsBatch : timing.ordinaryWrite
    const writeDelay = delayMilliseconds(range, options.random)
    options.onStage?.(`waiting:${step.id}`)
    await progress(index, { status: 'waiting', message: 'Waiting before write.',
      nextActionAt: scheduledAt(writeDelay, clock) })
    logger.event('step_waiting', 'started', { stepId: step.id, section: step.section })
    await wait(writeDelay)
    logger.event('step_waiting', 'succeeded', { stepId: step.id, section: step.section,
      durationMs: writeDelay })
    options.onStage?.(`writing:${step.id}`)
    await progress(index, { status: 'writing', message: 'Sending change to LinkedIn.' })
    const writeError = await writeStep({ client, accountId: plan.account.accountId, step, logger,
      accepted: () => progress(index,
        { status: 'write_accepted', message: 'Write accepted; waiting for LinkedIn.' }) })
    const checkDelay = delayMilliseconds(timing.readBack, options.random)
    options.onStage?.(`verifying:${step.id}:1/1`)
    await progress(index, { status: 'verifying', attempt: 1, maxAttempts: 1,
      message: 'Checking LinkedIn (1/1).', nextActionAt: scheduledAt(checkDelay, clock) })
    await wait(checkDelay)
    logger.event('verification_check', 'started', { stepId: step.id, section: step.section,
      attempt: 1, maxAttempts: 1 })
    let observation: Observation | undefined
    try {
      observation = await observeReadBack(client, plan.account.accountId, step)
      logger.event('verification_check', 'succeeded', { stepId: step.id, section: step.section,
        attempt: 1, maxAttempts: 1, observation })
    } catch (error) {
      logger.event('verification_check', 'failed', { stepId: step.id, section: step.section,
        attempt: 1, maxAttempts: 1, observation: 'unavailable', ...profileErrorDetails(error) })
    }
    if (observation !== 'matched') {
      const kind = failureKind(writeError, observation)
      if (kind !== 'write_rejected') {
        await progress(index, { status: 'verification_delayed', failureKind: kind,
          message: delayedMessage(kind) })
        logger.event('step_verification_delayed', 'succeeded', { stepId: step.id, section: step.section })
        continue
      }
      result.status = 'failed'
      await progress(index, { status: 'failed', failureKind: kind, errorCode: failureCode(writeError),
        message: rejectedMessage() })
      const finalResult = finishProgress(result, 'failed', clock)
      await options.onProgress?.(finalResult)
      logger.event('step', 'failed', { stepId: step.id, section: step.section,
        ...profileErrorDetails(writeError) })
      logger.event('run', 'failed', profileErrorDetails(writeError))
      return result
    }
    await progress(index, { status: 'verified', message: 'Verified in LinkedIn.' })
    logger.event('step', 'succeeded', { stepId: step.id, section: step.section })
  }
  await verifyFinal({ client, plan, result,
    range: timing.finalReadBack, wait, progress: progressMany, logger, clock,
    random: options.random, onStage: options.onStage })
  const delayed = result.steps.some(step => step.status === 'verification_delayed')
  const finalResult = finishProgress(result, delayed ? 'pending_verification' : 'verified', clock)
  await options.onProgress?.(finalResult)
  logger.event(delayed ? 'run_verification_delayed' : 'run', 'succeeded')
  return result
}
