import type { JsonObject, NamedParameter, ProfileInput, ValidationIssue } from '../input-types.ts'
import type { PlanStep, ProfileClient } from '../plan-types.ts'
import { linkedInPayload } from '../payloads.ts'
import { specifics } from '../profile-data.ts'

async function resolve(
  client: ProfileClient, accountId: string, type: 'JOB_TITLE' | 'LOCATION', value: NamedParameter
) {
  if (value.id) return { id: value.id, name: value.name }
  const matches = await client.searchParameters(accountId, type, value.name)
  const exact = matches.filter(item => item.name.toLowerCase() === value.name.toLowerCase())
  return exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined
}

export async function planOpenToWork(
  client: ProfileClient, accountId: string, desired: ProfileInput,
  current: JsonObject, issues: ValidationIssue[]
): Promise<PlanStep[]> {
  if (!desired.openToWork) return []
  const titles: Array<{ title: string; id: string }> = []
  for (const value of desired.openToWork.jobTitles) {
    const match = await resolve(client, accountId, 'JOB_TITLE', value)
    if (!match) {
      issues.push({ level: 'warning', path: 'profile.open_to_work.job_titles',
        message: `Не удалось определить ${value.name}.`, resolution: 'Open to Work пропущен.' })
      return []
    }
    titles.push({ title: match.name, id: match.id })
  }
  const locations: string[] = []
  for (const value of desired.openToWork.locations) {
    const match = await resolve(client, accountId, 'LOCATION', value)
    if (!match) {
      issues.push({ level: 'warning', path: 'profile.open_to_work.locations',
        message: `Не удалось определить ${value.name}.`, resolution: 'Open to Work пропущен.' })
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
