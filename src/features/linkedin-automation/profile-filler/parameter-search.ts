import { profileErrorDetails } from './errors.ts'
import { NOOP_PROFILE_LOGGER, type ProfileLogger } from './profile-logger.ts'
import type { ProfileClient } from './plan-types.ts'

export type SearchType = 'JOB_TITLE' | 'COMPANY' | 'SKILL' | 'EMPLOYMENT_TYPE'
export type Parameter = { id: string; name: string }

const key = (value: string) => value.trim().toLowerCase()

export function createParameterSearch(
  client: ProfileClient, accountId: string, logger: ProfileLogger = NOOP_PROFILE_LOGGER
) {
  const cache = new Map<string, Promise<Parameter[]>>()
  return async (type: SearchType, value: string) => {
    const cacheKey = `${type}:${key(value)}`
    logger.event('parameter_search', 'started', { operation: type })
    try {
      let request = cache.get(cacheKey)
      if (!request) {
        request = client.searchParameters(accountId, type, value)
        cache.set(cacheKey, request)
      }
      const matches = await request
      const exact = matches.find(item => key(item.name) === key(value))
      logger.event('parameter_search', 'succeeded', { operation: type,
        stepCount: matches.length, observation: exact ? 'matched' : 'unavailable' })
      return { exact, matches }
    } catch (error) {
      logger.event('parameter_search', 'failed', { operation: type, ...profileErrorDetails(error) })
      throw error
    }
  }
}
