import type { EducationUpsert, ExperienceUpsert, JsonObject, ProfileInput, YearMonth } from './input-types.ts'

const date = (value?: YearMonth) => value && `${value.year}-${String(value.month).padStart(2, '0')}`
const clean = (value: JsonObject) => Object.fromEntries(
  Object.entries(value).filter(([, item]) => item !== undefined)
)

function experience(entry: ExperienceUpsert) {
  return { action: 'upsert', match: clean({
    company: entry.match.company, job_title: entry.match.jobTitle, start_date: date(entry.match.startDate)
  }), data: clean({
    company: entry.data.company, job_title: entry.data.jobTitle,
    location: entry.data.location, workplace_type: entry.data.workplaceType,
    start_date: date(entry.data.startDate),
    end_date: date(entry.data.endDate), description: entry.data.description,
    source_of_hire: entry.data.sourceOfHire, skills: entry.data.skills
  }) }
}

function education(entry: EducationUpsert) {
  return { action: 'upsert', match: clean({
    school: entry.match.school, start_date: date(entry.match.startDate)
  }), data: clean({
    school: entry.data.school, degree: entry.data.degree, field_of_study: entry.data.fieldOfStudy,
    start_date: date(entry.data.startDate), end_date: date(entry.data.endDate), grade: entry.data.grade,
    activities: entry.data.activities, description: entry.data.description, skills: entry.data.skills
  }) }
}

export function profileDocument(input: ProfileInput): JsonObject {
  const profile: JsonObject = clean({
    headline: input.headline, about: input.about,
    skills: { add: input.skills.add, target_count: input.skills.targetCount },
    experience: input.experience.map(experience), education: input.education.map(education)
  })
  if (input.openToWork) profile.open_to_work = clean({
    job_titles: input.openToWork.jobTitles, workplace_types: input.openToWork.workplaceTypes,
    locations: input.openToWork.locations, start_date: input.openToWork.startDate,
    employment_types: input.openToWork.employmentTypes, visibility: input.openToWork.visibility
  })
  return { schema_version: 1, profile }
}
