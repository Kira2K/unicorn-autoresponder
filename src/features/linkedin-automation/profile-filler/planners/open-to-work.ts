import type { JsonObject, ProfileInput, ValidationIssue } from '../input-types.ts'
import { REQUIRED_ID_FIELDS } from '../mcp-contract.ts'
import { createParameterSearch, type ParameterSearchCache } from '../parameter-search.ts'
import type { PlanStep, ProfileClient } from '../plan-types.ts'
import type { ProfileLogger } from '../profile-logger.ts'
import { linkedInPayload } from '../payloads.ts'
import { specifics } from '../profile-data.ts'
import { editableFields } from '../editable-fields.ts'

export async function planOpenToWork(
  client: ProfileClient, accountId: string, desired: ProfileInput,
  current: JsonObject, issues: ValidationIssue[], logger?: ProfileLogger,
  parameterCache?: ParameterSearchCache, disabled: string[] = []
): Promise<PlanStep[]> {
  if (!desired.openToWork) return []
  const off = (key: string) => disabled.includes(`profile.open_to_work.${key}`)
  if (editableFields.open_to_work.every(off)) return []
  const missing = ['job_titles', 'locations', 'workplace_types', 'visibility'].filter(off)
  if (missing.length) {
    issues.push({ level: 'fatal', path: 'profile.open_to_work',
      message: 'Open to Work требует должности, города, форматы работы и видимость вместе.',
      resolution: 'Включите обязательные поля или выключите все поля Open to Work.' })
    return []
  }
  const resolve = createParameterSearch(client, accountId, logger, parameterCache)
  const titles: Array<{ title: string; id: string }> = []
  for (const [index, value] of desired.openToWork.jobTitles.entries()) {
    const issuePath = `profile.open_to_work.job_titles[${index}].name`
    if (value.id) { titles.push({ title: value.name, id: value.id }); continue }
    if (issues.some(issue => issue.level === 'fatal' && issue.path === issuePath)) return []
    const result = await resolve(REQUIRED_ID_FIELDS.openToWorkJobTitle, value.name)
    const match = result.exact
    if (!match) {
      issues.push({ level: 'warning', path: issuePath,
        message: `LinkedIn job title "${value.name}" was not resolved.`,
        resolution: 'Open to Work was skipped because no verified catalog value was available.',
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
      issues.push({ level: 'warning', path: 'profile.open_to_work.locations',
        message: `LinkedIn location "${value.name}" was not resolved.`,
        resolution: 'Open to Work was skipped because no verified catalog value was available.',
        suggestions: result.matches.slice(0, 8).map(item => item.name) })
      return []
    }
    locations.push(match.id)
  }
  const input = desired.openToWork
  const after: JsonObject = {
    job_title: titles, workplace: input.workplaceTypes.map(type => ({ type, location: locations })),
    ...(input.startDate && !off('start_date') ? { start_date: input.startDate } : {}),
    ...(input.employmentTypes.length && !off('employment_types') ? { employment_type: input.employmentTypes } : {}),
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
