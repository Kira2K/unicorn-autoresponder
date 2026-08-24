import type { EducationData, ExperienceData, JsonObject, YearMonth } from './input-types.ts'

export function linkedInPayload(field: string, value: unknown): JsonObject {
  return { specifics: { linkedin: { [field]: value } } }
}

const date = (value: YearMonth) => ({ year: value.year, month: value.month })

export function experiencePayload(data: ExperienceData, id?: string): JsonObject {
  return linkedInPayload('experience', {
    operation: id ? 'edit' : 'create', ...(id ? { id } : {}), notify_network: false,
    job_title: { name: data.jobTitle }, company: { name: data.company },
    ...(data.location ? { location: { name: data.location } } : {}),
    ...(data.workplaceType ? { workplace_type: data.workplaceType } : {}),
    ...(data.startDate ? { start_date: date(data.startDate) } : {}),
    ...(data.endDate ? { end_date: date(data.endDate) } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.sourceOfHire ? { source_of_hire: data.sourceOfHire } : {}),
    ...(data.skills.length ? { skills: data.skills.map(name => ({ name })) } : {})
  })
}

export function educationPayload(data: EducationData, id?: string): JsonObject {
  return linkedInPayload('education', {
    operation: id ? 'edit' : 'create', ...(id ? { id } : {}), notify_network: false,
    school: { name: data.school }, ...(data.degree ? { degree: { name: data.degree } } : {}),
    ...(data.fieldOfStudy ? { field_of_study: { name: data.fieldOfStudy } } : {}),
    ...(data.startDate ? { start_date: date(data.startDate) } : {}),
    ...(data.endDate ? { end_date: date(data.endDate) } : {}),
    ...(data.grade ? { grade: data.grade } : {}),
    ...(data.activities !== undefined ? { activities: data.activities } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.skills.length ? { skills: data.skills.map(name => ({ name })) } : {})
  })
}
