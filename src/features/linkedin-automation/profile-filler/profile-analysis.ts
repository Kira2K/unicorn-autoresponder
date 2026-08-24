import { randomUUID } from 'node:crypto'
import { codedError, profileErrorDetails } from './errors.ts'
import { createProfileLogger } from './profile-logger.ts'
import { logValidationFields } from './validation-logging.ts'
import { analyzeProfileFile } from './validator.ts'

export function runProfileAnalysis(body: unknown) {
  const logger = createProfileLogger({ jobId: `analysis-${randomUUID()}` })
  logger.event('analysis', 'started')
  try {
    if (JSON.stringify(body).length > 250_000) {
      throw codedError('profile_validation_failed', 'Profile JSON is too large.')
    }
    const result = analyzeProfileFile(body)
    logValidationFields(logger, result.document, result.issues)
    logger.event('analysis', 'succeeded', {
      issueCount: result.issues.length,
      fatalCount: result.issues.filter(item => item.level === 'fatal').length
    })
    return result
  } catch (error) {
    logger.event('analysis', 'failed', profileErrorDetails(error))
    throw error
  }
}
