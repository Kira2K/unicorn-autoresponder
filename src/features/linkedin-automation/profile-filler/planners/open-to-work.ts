import type { JsonObject, ProfileInput, ValidationIssue } from '../input-types.ts'
import { REQUIRED_ID_FIELDS } from '../mcp-contract.ts'
import { createParameterSearch } from '../parameter-search.ts'
import type { PlanStep, ProfileClient } from '../plan-types.ts'
import type { ProfileLogger } from '../profile-logger.ts'
import { linkedInPayload } from '../payloads.ts'
import { specifics } from '../profile-data.ts'

export async function planOpenToWork(
  client: ProfileClient, accountId: string, desired: ProfileInput,
  current: JsonObject, issues: ValidationIssue[], logger?: ProfileLogger
): Promise<PlanStep[]> {
  if (!desired.openToWork) return []
  const resolve = createParameterSearch(client, accountId, logger)
  const titles: Array<{ title: string; id: string }> = []
  for (const [index, value] of desired.openToWork.jobTitles.entries()) {
    const issuePath = `profile.open_to_work.job_titles[${index}].name`
    if (value.id) { titles.push({ title: value.name, id: value.id }); continue }
    if (issues.some(issue => issue.level === 'fatal' && issue.path === issuePath)) return []
    const result = await resolve(REQUIRED_ID_FIELDS.openToWorkJobTitle, value.name)
    const match = result.exact
    if (!match) {
      issues.push({ level: 'fatal', path: issuePath,
        message: `LinkedIn job title "${value.name}" was not resolved.`,
        resolution: 'Choose one exact LinkedIn value and rebuild Preview.',
        suggestions: result.matches.slice(0, 5).map(item => item.name) })
      return []
    }
    titles.push({ title: match.name, id: match.id })
  }
  const locations: string[] = []
  for (const value of desired.openToWork.locations) {
    const result = await resolve(REQUIRED_ID_FIELDS.openToWorkLocation, value.name)
    const match = result.exact
    if (!match) {
      issues.push({ level: 'fatal', path: 'profile.open_to_work.locations',
        message: `LinkedIn location "${value.name}" was not resolved.`,
        resolution: 'Choose one exact LinkedIn value and rebuild Preview.',
        suggestions: result.matches.slice(0, 8).map(item => item.name) })
      return []
    }
    locations.push(match.id)
  }
  const input = desired.openToWork
  const after: JsonObject = {
    job_title: titles, workplace: input.workplaceTypes.map(type => ({ type, location: locations })),
    ...(input.startDate ? { start_date: input.startDate } : {}),
    ...(input.employmentTypes.length ? { employment_type: input.employmentTypes } : {}),
    visibility: input.visibility
  }
  const currentSpecifics = specifics(current)
  return [{
    id: 'open-to-work', section: 'open_to_work', action: 'update',
    summary: 'Включить или обновить Open to Work',
    before: currentSpecifics.open_to_work ?? null, after,
    payload: linkedInPayload('open_to_work', after),
    verification: { kind: 'open_to_work', expected: after }
  }]
}
