import type { ProfileInput, ValidationIssue } from './input-types.ts'
import { createParameterSearch, type ParameterSearchCache } from './parameter-search.ts'
import type { ProfileClient } from './plan-types.ts'
import type { ProfileLogger } from './profile-logger.ts'

async function exactOrName(search: ReturnType<typeof createParameterSearch>,
  type: 'COMPANY' | 'JOB_TITLE' | 'LOCATION' | 'SCHOOL', value?: string) {
  if (!value) return undefined
  const found = await search(type, value)
  return found.exact ?? { name: value }
}

export async function resolveProfileCatalog(options: {
  client: ProfileClient
  accountId: string
  desired: ProfileInput
  issues: ValidationIssue[]
  logger?: ProfileLogger
  parameterCache?: ParameterSearchCache
}) {
  const { client, accountId, logger } = options
  const desired = structuredClone(options.desired)
  const search = createParameterSearch(client, accountId, logger, options.parameterCache)

  for (const entry of desired.experience) {
    entry.data.catalog = {
      company: await exactOrName(search, 'COMPANY', entry.data.company),
      jobTitle: await exactOrName(search, 'JOB_TITLE', entry.data.jobTitle),
      location: await exactOrName(search, 'LOCATION', entry.data.location)
    }
  }
  for (const entry of desired.education) {
    entry.data.catalog = { school: await exactOrName(search, 'SCHOOL', entry.data.school) }
  }
  return desired
}
