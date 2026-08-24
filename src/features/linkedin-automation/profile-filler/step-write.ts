import { profileErrorDetails } from './errors.ts'
import type { ProfileLogger } from './profile-logger.ts'
import type { PlanStep, ProfileClient } from './plan-types.ts'

export async function writeStep(options: {
  client: ProfileClient
  accountId: string
  step: PlanStep
  logger: ProfileLogger
  accepted(): void | Promise<void>
}) {
  const { client, accountId, step, logger, accepted } = options
  const linkedin = (step.payload.specifics as any)?.linkedin ?? {}
  const field = Object.keys(linkedin)[0]
  const nested = field && linkedin[field] && typeof linkedin[field] === 'object'
    ? Object.keys(linkedin[field]) : []
  const details = { stepId: step.id, section: step.section, operation: step.action,
    payloadFields: [field, ...nested].filter(Boolean) }
  logger.event('write', 'started', details)
  try {
    await client.updateOwnProfile(accountId, step.payload)
    await accepted()
    logger.event('write', 'succeeded', details)
    return undefined
  } catch (error) {
    logger.event('write', 'failed', { ...details, ...profileErrorDetails(error) })
    return error
  }
}
