import type { FillResult, FillStepResult, ProfilePlan } from './plan-types.ts'

type Clock = () => number

export function createProgress(plan: ProfilePlan, clock: Clock = Date.now): FillResult {
  const startedAt = new Date(clock()).toISOString()
  return {
    status: 'running', startedAt, updatedAt: startedAt,
    steps: plan.steps.map(step => ({
      stepId: step.id, section: step.section, status: 'pending', message: 'Waiting to start.'
    }))
  }
}

export function scheduledAt(delayMs: number, clock: Clock = Date.now) {
  return new Date(clock() + delayMs).toISOString()
}

export function updateProgress(
  result: FillResult, index: number, patch: Partial<FillStepResult>, clock: Clock = Date.now
) {
  const nowMs = clock()
  const now = new Date(nowMs).toISOString()
  const step = result.steps[index]
  const status = patch.status ?? step.status
  if (!step.startedAt && status !== 'pending') step.startedAt = now
  Object.assign(step, patch, { updatedAt: now })
  if (!['waiting', 'verifying'].includes(status)) delete step.nextActionAt
  if (['verification_delayed', 'pending_retry', 'verified', 'failed'].includes(status)) {
    step.completedAt = now
    step.durationMs = Math.max(0, nowMs - Date.parse(step.startedAt ?? now))
  } else { delete step.completedAt; delete step.durationMs }
  result.updatedAt = now
  return structuredClone(result)
}

export function finishProgress(
  result: FillResult, status: 'pending_verification' | 'verified' | 'failed', clock: Clock = Date.now
) {
  const finishedAt = new Date(clock()).toISOString()
  Object.assign(result, { status, updatedAt: finishedAt, finishedAt })
  return structuredClone(result)
}
