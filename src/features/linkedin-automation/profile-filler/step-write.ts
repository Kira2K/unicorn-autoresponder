import { profileErrorDetails } from './errors.ts'
import type { ProfileLogger } from './profile-logger.ts'
import type { PlanStep, ProfileClient, ProfilePlan } from './plan-types.ts'
import { prepareStep } from './prepare-step.ts'

export async function writeStep(options: {
  client: ProfileClient
  accountId: string
  step: PlanStep
  logger: ProfileLogger
  beforeWrite(step: PlanStep): void | Promise<void>
  skillPolicy?: ProfilePlan['skillPolicy']
  accepted(): void | Promise<void>
}) {
  const { client, accountId, step, logger, accepted } = options
  let prepared
  try {
    prepared = await prepareStep(client, accountId, step, logger, options.skillPolicy)
  } catch (error) {
    return { error, step }
  }
  if (prepared.mode === 'skip') return { skipped: true, step: prepared.step }
  const effective = prepared.step
  const specifics = effective.payload.specifics as Record<string, unknown> | undefined
  const linkedin = (specifics?.linkedin ?? {}) as Record<string, unknown>
  const field = Object.keys(linkedin)[0]
  const nested = field && linkedin[field] && typeof linkedin[field] === 'object'
    ? Object.keys(linkedin[field]) : []
  const details = { stepId: effective.id, section: effective.section, operation: effective.action,
    payloadFields: [field, ...nested].filter(Boolean) }
  await options.beforeWrite(effective)
  logger.event('write', 'started', details)
  let responseError: unknown
  try {
    await client.updateOwnProfile(accountId, effective.payload)
    logger.event('write', 'succeeded', details)
  } catch (error) {
    logger.event('write', 'failed', { ...details, ...profileErrorDetails(error) })
    responseError = error
  }
  // Persistence failure is not a provider rejection and must stop the executor.
  if (!responseError) await accepted()
  return { error: responseError, step: effective }
}
