import type { EducationUpsert, ExperienceUpsert, JsonObject } from './input-types.ts'
import { dateKey, name, normalizeEducation, readDate } from './profile-data.ts'
import { matchesDate } from './date-policy.ts'

const skillSet = (value: unknown[]) => new Set(value.map(item => normalized(item)))

export function differs(current: JsonObject, desired: JsonObject) {
  return Object.entries(desired).some(([key, expected]) => {
    if (expected === undefined) return false
    const actual = current[key]
    if (key === 'end_date' && expected === 'present') return actual !== undefined && actual !== null
    if (key === 'skills' && Array.isArray(expected)) {
      const available = skillSet(Array.isArray(actual) ? actual : [])
      return expected.some(item => !available.has(normalized(item)))
    }
    if (['start_date', 'end_date'].includes(key) && typeof expected === 'string' && /^\d{4}$/.test(expected)) {
      return String(actual ?? '').slice(0, 4) !== expected
    }
    if (['company', 'job_title', 'school', 'degree', 'field_of_study', 'location'].includes(key)) {
      return normalized(actual) !== normalized(expected)
    }
    return JSON.stringify(actual) !== JSON.stringify(expected)
  })
}

export function experienceMatches(item: JsonObject, match: ExperienceUpsert['match']) {
  const identityMatches = normalized(name(item.company)) === normalized(match.company) &&
    normalized(name(item.job_title)) === normalized(match.jobTitle)
  return identityMatches && matchesDate(dateKey(readDate(item.started_on ?? item.start_date)), match.startDate)
}

export function educationMatches(item: JsonObject, match: EducationUpsert['match']) {
  const schoolMatches = normalized(name(item.school)) === normalized(match.school)
  return schoolMatches && matchesDate(dateKey(readDate(item.started_on ?? item.start_date)), match.startDate)
}

function normalized(value: unknown) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function educationDetailsMatch(item: JsonObject, data: EducationUpsert['data']) {
  const current = normalizeEducation(item)
  const expected = [
    ['degree', data.degree],
    ['field_of_study', data.fieldOfStudy]
  ] as const
  const known = expected.filter(([, value]) => normalized(value))
  return known.length > 0 && known.every(([key, value]) =>
    normalized(current[key]) === normalized(value))
}

export function educationCandidates(entries: JsonObject[], entry: EducationUpsert) {
  const base = entries.filter(item => educationMatches(item, entry.match))
  const detailed = base.filter(item => educationDetailsMatch(item, entry.data))
  if (detailed.length) return detailed
  return base.filter(item => {
    const current = normalizeEducation(item)
    return !([['degree', entry.data.degree], ['field_of_study', entry.data.fieldOfStudy]] as const)
      .some(([key, expected]) => normalized(expected) && normalized(current[key]) &&
        normalized(expected) !== normalized(current[key]))
  })
}

export function experienceCandidates(entries: JsonObject[], entry: ExperienceUpsert) {
  const strict = entries.filter(item => experienceMatches(item, entry.match))
  if (strict.length) return strict
  return entries.filter(item => normalized(name(item.company)) === normalized(entry.match.company) &&
    (normalized(name(item.job_title)) === normalized(entry.match.jobTitle) ||
      Boolean(entry.match.startDate && matchesDate(dateKey(readDate(item.started_on ?? item.start_date)),
        entry.match.startDate))))
}
