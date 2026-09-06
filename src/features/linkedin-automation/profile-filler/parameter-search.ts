import { profileErrorDetails } from './errors.ts'
import type { CatalogType } from './mcp-contract.ts'
import { NOOP_PROFILE_LOGGER, type ProfileLogger } from './profile-logger.ts'
import type { ProfileClient } from './plan-types.ts'

export type SearchType = CatalogType
export type Parameter = { id: string; name: string }
export type ParameterSearchCache = Record<string, Parameter[]>

const key = (value: string) => value.normalize('NFKC').trim().toLowerCase()
  .replace(/[_\-–—]+/g, ' ').replace(/\s+/g, ' ')

export function createParameterSearch(
  client: ProfileClient, accountId: string, logger: ProfileLogger = NOOP_PROFILE_LOGGER,
  persisted?: ParameterSearchCache
) {
  const cache = new Map<string, Promise<Parameter[]>>()
  return async (type: SearchType, value: string) => {
    const cacheKey = `${type}:${key(value)}`
    logger.event('parameter_search', 'started', { operation: type })
    try {
      let request = cache.get(cacheKey)
      if (!request) {
        if (persisted && Object.prototype.hasOwnProperty.call(persisted, cacheKey)) {
          request = Promise.resolve(structuredClone(persisted[cacheKey]))
        } else {
          request = client.searchParameters(accountId, type, value).then(matches => {
            if (persisted) persisted[cacheKey] = structuredClone(matches)
            return matches
          })
        }
        cache.set(cacheKey, request)
      }
      const matches = await request
      const exactMatches = matches.filter(item => key(item.name) === key(value))
      const exact = exactMatches.length === 1 ? exactMatches[0] : undefined
      logger.event('parameter_search', 'succeeded', { operation: type,
        stepCount: matches.length, observation: exact ? 'matched' : 'unavailable' })
      return { exact, matches, exactCount: exactMatches.length }
    } catch (error) {
      cache.delete(cacheKey)
      logger.event('parameter_search', 'failed', { operation: type, ...profileErrorDetails(error) })
      throw error
    }
  }
}
