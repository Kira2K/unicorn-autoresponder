import type { ProfileInput, ValidationIssue } from '../input-types.ts'
import { logAction } from '../log-action.ts'
import { REQUIRED_ID_FIELDS } from '../mcp-contract.ts'
import { createParameterSearch, type Parameter, type ParameterSearchCache } from '../parameter-search.ts'
import type { ProfileClient } from '../plan-types.ts'
import type { ProfileLogger } from '../profile-logger.ts'
import type { JobTitleChoice, JobTitleChoiceRequest } from './types.ts'
import { jobTitleCatalogQueries } from './job-title-queries.ts'
import { withCatalogRetry, type CatalogRetry } from './catalog-retry.ts'

const key = (value: string) => value.normalize('NFKC').trim().toLowerCase()
const candidates = (items: Parameter[]) => {
  const seen = new Set<string>()
  return items.filter(item => {
    const value = `${item.id}:${key(item.name)}`
    if (seen.has(value)) return false
    seen.add(value); return true
  }).slice(0, 40)
}

const words = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9+#]+/g) ?? [])
const ranked = (requested: string, items: Parameter[]) => {
  const wanted = words(requested)
  return [...items].sort((left, right) => {
    const score = (item: Parameter) => [...words(item.name)].filter(word => wanted.has(word)).length
    return score(right) - score(left)
  }).slice(0, 15)
}

export async function groundJobTitles(options: {
  client: ProfileClient; accountId: string; input: ProfileInput; issues: ValidationIssue[]
  logger: ProfileLogger
  choose?: (requests: JobTitleChoiceRequest[]) => Promise<JobTitleChoice[]>
  parameterCache?: ParameterSearchCache
  retry?: { sleep?: (ms: number) => Promise<void>; random?: () => number; now?: () => number
    onRetry?: (retry: CatalogRetry) => Promise<void> | void }
}) {
  const { client, accountId, logger } = options
  const input = structuredClone(options.input); const issues = [...options.issues]
  if (!input.openToWork) return { input, issues }
  const resolve = createParameterSearch(client, accountId, logger, options.parameterCache)
  const titles = input.openToWork.jobTitles
  let pool: Parameter[] = []
  for (const [attempt, query] of jobTitleCatalogQueries(titles.map(item => item.name)).entries()) {
    const result = await withCatalogRetry(() => resolve(REQUIRED_ID_FIELDS.openToWorkJobTitle, query), {
      logger, ...options.retry
    })
    pool = candidates([...pool, ...result.matches])
    logger.event('job_title_catalog_query', 'succeeded', { attempt: attempt + 1,
      stepCount: result.matches.length, observation: result.matches.length ? 'matched' : 'unavailable' })
  }
  const requests: JobTitleChoiceRequest[] = []
  const reservedIds = new Set<string>()
  for (const [index, title] of input.openToWork.jobTitles.entries()) {
    const exact = pool.filter(item => key(item.name) === key(title.name) && !reservedIds.has(item.id))
    if (exact.length === 1) {
      input.openToWork.jobTitles[index] = exact[0]; reservedIds.add(exact[0].id)
    }
    else requests.push({ index, requested: title.name, candidates: ranked(title.name, pool) })
  }
  let choices: JobTitleChoice[] = []
  if (requests.length && options.choose) {
    try { choices = await logAction(logger, 'job_title_catalog_choice',
      () => options.choose!(requests), { stepCount: requests.length }) }
    catch { choices = [] }
  }
  const usedIds = new Set(input.openToWork.jobTitles.flatMap(title => title.id ? [title.id] : []))
  for (const request of requests) {
    const selected = request.candidates.find(candidate => choices.some(choice =>
      choice.index === request.index && choice.confident && choice.candidateId === candidate.id) &&
      !usedIds.has(candidate.id))
    if (selected) {
      input.openToWork.jobTitles[request.index] = selected; usedIds.add(selected.id)
    }
  }
  const requestedCount = input.openToWork.jobTitles.length
  const resolved = input.openToWork.jobTitles.filter(title => Boolean(title.id))
  if (!resolved.length) {
    input.openToWork = undefined
    issues.push({ level: 'warning', path: 'profile.open_to_work',
      message: 'No verified LinkedIn job titles were found. Open to Work was skipped.',
      resolution: 'Review the generated profile and configure Open to Work manually if needed.' })
  } else {
    input.openToWork.jobTitles = resolved
    if (resolved.length < requestedCount) issues.push({ level: 'warning',
      path: 'profile.open_to_work.job_titles',
      message: `Only ${resolved.length} of ${requestedCount} job titles were verified.`,
      resolution: 'Open to Work will use only the verified LinkedIn catalog values.' })
  }
  logger.event('job_title_catalog_grounding', 'succeeded', { stepCount: resolved.length,
    issueCount: requestedCount - resolved.length,
    observation: resolved.length ? 'matched' : 'unavailable' })
  return { input, issues }
}
