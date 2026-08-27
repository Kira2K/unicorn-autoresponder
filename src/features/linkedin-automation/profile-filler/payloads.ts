import type { EducationData, ExperienceData, JsonObject, YearMonth } from './input-types.ts'
import { desiredEducation, desiredExperience } from './profile-data.ts'

export function linkedInPayload(field: string, value: unknown): JsonObject {
  return { specifics: { linkedin: { [field]: value } } }
}

const date = (value: YearMonth) => ({ year: value.year, month: value.month })
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

function editFields(fields: JsonObject, before: JsonObject | undefined, after: JsonObject) {
  if (!before) return fields
  return Object.fromEntries(Object.entries(fields).filter(([key]) => !same(before[key], after[key])))
}

export function experiencePayload(data: ExperienceData, id?: string, before?: JsonObject): JsonObject {
  const fields: JsonObject = {
    job_title: { name: data.jobTitle }, company: { name: data.company },
    ...(data.location ? { location: { name: data.location } } : {}),
    ...(data.workplaceType ? { workplace_type: data.workplaceType } : {}),
    ...(data.startDate ? { start_date: date(data.startDate) } : {}),
    ...(data.endDate ? { end_date: date(data.endDate) } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.sourceOfHire ? { source_of_hire: data.sourceOfHire } : {}),
    ...(data.skills.length ? { skills: data.skills.map(name => ({ name })) } : {})
  }
  const body = id
    ? { operation: 'edit', id, ...editFields(fields, before, desiredExperience(data)) }
    : { operation: 'create', notify_network: false, ...fields }
  return linkedInPayload('experience', body)
}

export function educationPayload(data: EducationData, id?: string, before?: JsonObject): JsonObject {
  const fields: JsonObject = {
    school: { name: data.school }, ...(data.degree ? { degree: { name: data.degree } } : {}),
    ...(data.fieldOfStudy ? { field_of_study: { name: data.fieldOfStudy } } : {}),
    ...(data.startDate ? { start_date: date(data.startDate) } : {}),
    ...(data.endDate ? { end_date: date(data.endDate) } : {}),
    ...(data.grade ? { grade: data.grade } : {}),
    ...(data.activities !== undefined ? { activities: data.activities } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.skills.length ? { skills: data.skills.map(name => ({ name })) } : {})
  }
  const body = id
    ? { operation: 'edit', id, ...editFields(fields, before, desiredEducation(data)) }
    : { operation: 'create', notify_network: false, ...fields }
  return linkedInPayload('education', body)
}
