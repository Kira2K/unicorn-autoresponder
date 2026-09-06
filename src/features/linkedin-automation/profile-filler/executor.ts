import { delayedMessage, failureCode, failureKind, rejectedMessage } from './failure-state.ts'
import { profileErrorDetails } from './errors.ts'
import { verifyFinal } from './final-verification.ts'
import { observeReadBack, type Observation } from './observe.ts'
import { NOOP_PROFILE_LOGGER, type ProfileLogger } from './profile-logger.ts'
import type { FillResult, FillStepResult, ProfileClient, ProfilePlan } from './plan-types.ts'
import { createProgress, finishProgress, scheduledAt, updateProgress } from './progress-state.ts'
import { DEFAULT_TIMING, delayMilliseconds, type TimingPolicy } from './timing.ts'
import { writeStep } from './step-write.ts'
import { providerDelayMs } from './provider-delay.ts'
import { assertDistinctPlanTargets } from './entry-claims.ts'
export type ExecutorOptions = {
  timing?: TimingPolicy
  wait?: (milliseconds: number) => Promise<void>; clock?: () => number
  random?: (minimum: number, maximumExclusive: number) => number
  onStage?: (stage: string) => void; logger?: ProfileLogger
  onProgress?: (result: FillResult) => void | Promise<void>
}
export async function executeProfilePlan(client: ProfileClient, plan: ProfilePlan,
  options: ExecutorOptions = {}): Promise<FillResult> {
  assertDistinctPlanTargets(plan)
  const logger = options.logger ?? NOOP_PROFILE_LOGGER
  logger.event('run', 'started', { stepCount: plan.steps.length })
  if (!plan.steps.length) { logger.event('run', 'succeeded', { stepCount: 0 })
    return { status: 'no_changes', steps: [] } }
  const timing = options.timing ?? DEFAULT_TIMING
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const clock = options.clock ?? Date.now; const result = createProgress(plan, clock)
  const progressMany = async (updates: Array<{ index: number; patch: Partial<FillStepResult> }>) => {
    let snapshot = structuredClone(result)
    updates.forEach(({ index, patch }) => { snapshot = updateProgress(result, index, patch, clock) })
    await options.onProgress?.(snapshot)
  }
  const progress = (index: number, patch: Partial<FillStepResult>) => progressMany([{ index, patch }])
  await options.onProgress?.(structuredClone(result))
  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index]; const previous = plan.steps[index - 1]
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
    const write = await writeStep({ client, accountId: plan.account.accountId, step, logger,
      skillPolicy: plan.skillPolicy,
      beforeWrite: effective => progress(index, { status: 'writing',
        writeIntent: { step: structuredClone(effective), savedAt: new Date(clock()).toISOString() },
        message: 'Write intent saved before sending.' }),
      accepted: () => progress(index,
        { status: 'write_accepted', message: 'Write accepted; waiting for LinkedIn.' }) })
    if (write.skipped) {
      await progress(index, { status: 'verified', message: 'Already present; write skipped.' })
      logger.event('step', 'succeeded', { stepId: step.id, section: step.section, operation: 'skipped' })
      continue
    }
    const effectiveStep = write.step; const writeError = write.error
    const checkDelay = Math.max(delayMilliseconds(timing.readBack, options.random), providerDelayMs(writeError))
    options.onStage?.(`verifying:${step.id}:1/1`)
    await progress(index, { status: 'verifying', attempt: 1, maxAttempts: 1,
      message: 'Checking LinkedIn (1/1).', nextActionAt: scheduledAt(checkDelay, clock) })
    await wait(checkDelay)
    logger.event('verification_check', 'started', { stepId: step.id, section: step.section,
      attempt: 1, maxAttempts: 1 })
    let observation: Observation | undefined
    try {
      observation = await observeReadBack(client, plan.account.accountId, effectiveStep)
      logger.event('verification_check', 'succeeded', { stepId: step.id, section: step.section,
        attempt: 1, maxAttempts: 1, observation })
    } catch (error) {
      const delay = providerDelayMs(error)
      if (delay) result.verification = { attempt: 0, maxAttempts: 4,
        notBefore: scheduledAt(delay, clock) }
      logger.event('verification_check', 'failed', { stepId: step.id, section: step.section,
        attempt: 1, maxAttempts: 1, observation: 'unavailable', ...profileErrorDetails(error) })
    }
    if (observation !== 'matched') {
      const kind = failureKind(writeError, observation)
      if (!['write_rejected', 'prewrite_blocked'].includes(kind)) {
        await progress(index, { status: 'verification_delayed', failureKind: kind,
          errorCode: writeError ? failureCode(writeError) : undefined,
          message: delayedMessage(kind) })
        logger.event('step_verification_delayed', 'succeeded', { stepId: step.id, section: step.section })
        if (kind === 'write_uncertain' || effectiveStep.action === 'create' || step.section === 'skills' ||
          result.verification?.notBefore) {
          logger.event('writes_blocked', 'succeeded', { stepId: step.id, section: step.section })
          break
        }
        continue
      }
      await progress(index, { status: 'pending_retry', failureKind: kind,
        errorCode: failureCode(writeError), message: rejectedMessage(kind) })
      logger.event('step', 'failed', { stepId: step.id, section: step.section,
        ...profileErrorDetails(writeError) })
      logger.event('step_pending_retry', 'succeeded', { stepId: step.id, section: step.section })
      if (kind === 'prewrite_blocked') break
      continue
    }
    await progress(index, { status: 'verified', message: 'Verified in LinkedIn.' })
    logger.event('step', 'succeeded', { stepId: step.id, section: step.section })
    if (writeError && failureKind(writeError) === 'write_uncertain') {
      logger.event('writes_blocked', 'succeeded', { stepId: step.id, section: step.section })
      break
    }
  }
  await verifyFinal({ client, plan, result,
    range: timing.finalReadBack, scheduleSeconds: timing.verificationScheduleSeconds,
    wait, progress: progressMany, logger, clock, random: options.random,
    recheckVerified: true, onStage: options.onStage })
  const failed = result.steps.some(step => step.status !== 'verified')
  const finalResult = finishProgress(result, failed ? 'failed' : 'verified', clock)
  await options.onProgress?.(finalResult)
  logger.event(failed ? 'run_needs_expert_review' : 'run', failed ? 'failed' : 'succeeded')
  return result
}

export async function resumeProfileVerification(client: ProfileClient, plan: ProfilePlan,
  saved: FillResult, options: ExecutorOptions = {}) {
  const logger = options.logger ?? NOOP_PROFILE_LOGGER
  const timing = options.timing ?? DEFAULT_TIMING
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const clock = options.clock ?? Date.now
  const result = structuredClone(saved)
  const progress = async (updates: Array<{ index: number; patch: Partial<FillStepResult> }>) => {
    let snapshot = structuredClone(result)
    updates.forEach(({ index, patch }) => { snapshot = updateProgress(result, index, patch, clock) })
    await options.onProgress?.(snapshot)
  }
  await verifyFinal({ client, plan, result, range: timing.finalReadBack,
    scheduleSeconds: timing.verificationScheduleSeconds, wait, progress, logger, clock,
    random: options.random, onStage: options.onStage })
  const failed = result.steps.some(step => step.status !== 'verified')
  const finalResult = finishProgress(result, failed ? 'failed' : 'verified', clock)
  await options.onProgress?.(finalResult)
  return finalResult
}
