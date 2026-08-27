import { profileErrorDetails } from './errors.ts'
import type { ProfileLogger } from './profile-logger.ts'
import type { PlanStep, ProfileClient } from './plan-types.ts'
import { prepareStep } from './prepare-step.ts'

export async function writeStep(options: {
  client: ProfileClient
  accountId: string
  step: PlanStep
  logger: ProfileLogger
  accepted(): void | Promise<void>
}) {
  const { client, accountId, step, logger, accepted } = options
  let prepared
  try {
    prepared = await prepareStep(client, accountId, step, logger)
  } catch (error) {
    return { error, step }
  }
  if (prepared.mode === 'skip') return { skipped: true, step: prepared.step }
  const effective = prepared.step
  const linkedin = (effective.payload.specifics as any)?.linkedin ?? {}
  const field = Object.keys(linkedin)[0]
  const nested = field && linkedin[field] && typeof linkedin[field] === 'object'
    ? Object.keys(linkedin[field]) : []
  const details = { stepId: effective.id, section: effective.section, operation: effective.action,
    payloadFields: [field, ...nested].filter(Boolean) }
  logger.event('write', 'started', details)
  try {
    await client.updateOwnProfile(accountId, effective.payload)
    await accepted()
    logger.event('write', 'succeeded', details)
    return { step: effective }
  } catch (error) {
    logger.event('write', 'failed', { ...details, ...profileErrorDetails(error) })
    return { error, step: effective }
  }
}
