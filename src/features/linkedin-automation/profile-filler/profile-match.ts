import type { EducationUpsert, ExperienceUpsert, JsonObject } from './input-types.ts'
import { dateKey, name, readDate } from './profile-data.ts'

export function differs(current: JsonObject, desired: JsonObject) {
  return Object.entries(desired).some(([key, value]) =>
    value !== undefined && JSON.stringify(current[key]) !== JSON.stringify(value))
}

export function experienceMatches(item: JsonObject, match: ExperienceUpsert['match']) {
  const identityMatches = name(item.company)?.toLowerCase() === match.company.toLowerCase() &&
    name(item.job_title)?.toLowerCase() === match.jobTitle.toLowerCase()
  return identityMatches && (!match.startDate ||
    dateKey(readDate(item.started_on ?? item.start_date)) === dateKey(match.startDate))
}

export function educationMatches(item: JsonObject, match: EducationUpsert['match']) {
  const schoolMatches = name(item.school)?.toLowerCase() === match.school.toLowerCase()
  return schoolMatches && (!match.startDate ||
    dateKey(readDate(item.started_on ?? item.start_date)) === dateKey(match.startDate))
}
