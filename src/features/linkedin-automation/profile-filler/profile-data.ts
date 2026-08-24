import type { EducationData, ExperienceData, JsonObject, YearMonth } from './input-types.ts'
import { isObject, text } from './validation/shared.ts'

export function name(value: unknown) {
  if (typeof value === 'string') return text(value)
  return isObject(value) ? text(value.name ?? value.title) : undefined
}

export function specifics(profile: JsonObject): JsonObject {
  if (!isObject(profile.specifics)) return {}
  return isObject(profile.specifics.linkedin) ? profile.specifics.linkedin : profile.specifics
}

export function section(profile: JsonObject, key: string): JsonObject[] {
  const value = specifics(profile)[key]
  return Array.isArray(value) ? value.filter(isObject) : []
}

export function sectionReadable(profile: JsonObject, key: string) {
  const raw = specifics(profile)
  const throttled = Array.isArray(profile.throttled_sections) ? profile.throttled_sections : []
  return !throttled.includes(`linkedin_${key}`) && Array.isArray(raw[key])
}

export function readDate(value: unknown): YearMonth | undefined {
  if (isObject(value)) {
    const year = Number(value.year)
    const month = Number(value.month)
    if (Number.isInteger(year) && Number.isInteger(month)) return { year, month }
  }
  const match = text(value)?.match(/^(\d{4})-(0?[1-9]|1[0-2])(?:-\d{2})?$/)
  return match ? { year: Number(match[1]), month: Number(match[2]) } : undefined
}

export function dateKey(value?: YearMonth) {
  return value ? `${value.year}-${String(value.month).padStart(2, '0')}` : undefined
}

export function normalizeExperience(item: JsonObject): JsonObject {
  return {
    company: name(item.company), job_title: name(item.job_title),
    location: name(item.location),
    workplace_type: text(item.workplace_type),
    start_date: dateKey(readDate(item.started_on ?? item.start_date)),
    end_date: dateKey(readDate(item.ended_on ?? item.end_date)),
    description: typeof item.description === 'string' ? item.description : undefined,
    skills: Array.isArray(item.skills) ? item.skills.map(name).filter(Boolean) : []
  }
}

export function desiredExperience(data: ExperienceData): JsonObject {
  return {
    company: data.company, job_title: data.jobTitle, location: data.location,
    workplace_type: data.workplaceType,
    start_date: dateKey(data.startDate), end_date: dateKey(data.endDate),
    description: data.description, skills: data.skills
  }
}

export function normalizeEducation(item: JsonObject): JsonObject {
  return {
    school: name(item.school), degree: name(item.degree), field_of_study: name(item.field_of_study),
    start_date: dateKey(readDate(item.started_on ?? item.start_date)),
    end_date: dateKey(readDate(item.ended_on ?? item.end_date)), grade: text(item.grade),
    activities: typeof item.activities === 'string' ? item.activities : undefined,
    description: typeof item.description === 'string' ? item.description : undefined,
    skills: Array.isArray(item.skills) ? item.skills.map(name).filter(Boolean) : []
  }
}

export function desiredEducation(data: EducationData): JsonObject {
  return {
    school: data.school, degree: data.degree, field_of_study: data.fieldOfStudy,
    start_date: dateKey(data.startDate), end_date: dateKey(data.endDate), grade: data.grade,
    activities: data.activities, description: data.description, skills: data.skills
  }
}
