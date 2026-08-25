import { profileErrorDetails } from './errors.ts'
import type { ProfileLogDetails, ProfileLogger } from './profile-logger.ts'

export async function logAction<T>(
  logger: ProfileLogger,
  stage: string,
  action: () => T | Promise<T>,
  details: ProfileLogDetails = {}
): Promise<T> {
  const startedAt = Date.now()
  logger.event(stage, 'started', details)
  try {
    const result = await action()
    logger.event(stage, 'succeeded', { ...details, durationMs: Date.now() - startedAt })
    return result
  } catch (error) {
    logger.event(stage, 'failed', { ...details, durationMs: Date.now() - startedAt,
      ...profileErrorDetails(error) })
    throw error
  }
}
