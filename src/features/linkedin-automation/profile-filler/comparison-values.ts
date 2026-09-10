import type { JsonObject, ProfileInput } from './input-types.ts'
import { normalizeEducation, normalizeExperience, section, sectionReadable } from './profile-data.ts'
import { educationCandidates, experienceCandidates } from './profile-match.ts'

// Display data only. Unchanged and blocked records still need a truthful "Before" column.
export function comparisonValues(input: ProfileInput, current: JsonObject): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  if (input.headline !== undefined) values.headline = current.description
  if (input.about !== undefined) values.about = current.bio
  input.experience.forEach((entry, index) => {
    const matches = experienceCandidates(section(current, 'experience'), entry)
    values[`experience-${index + 1}`] = !sectionReadable(current, 'experience') || matches.length > 1
      ? undefined : matches.length ? normalizeExperience(matches[0]) : null
  })
  input.education.forEach((entry, index) => {
    const matches = educationCandidates(section(current, 'education'), entry)
    values[`education-${index + 1}`] = !sectionReadable(current, 'education') || matches.length > 1
      ? undefined : matches.length ? normalizeEducation(matches[0]) : null
  })
  return values
}
