import type { JsonObject, ProfileInput } from './input-types.ts'
import type { PlanStep } from './plan-types.ts'
import { section } from './profile-data.ts'
import { educationCandidates, experienceCandidates } from './profile-match.ts'

// Bind from the original document, never from the user's edited degree or role.
export function bindEntryTargets(input: ProfileInput, profile: JsonObject, steps: PlanStep[] = []): ProfileInput {
  const bound = structuredClone(input)
  for (const group of ['experience', 'education'] as const) {
    bound[group].forEach((entry, index) => {
      if (entry.match.linkedInId) return
      const spec = steps.find(step => step.id === `${group}-${index + 1}`)?.verification
      const savedId = spec && 'id' in spec ? spec.id : undefined
      const matches = group === 'experience'
        ? experienceCandidates(section(profile, group), bound.experience[index])
        : educationCandidates(section(profile, group), bound.education[index])
      const id = savedId ?? (matches.length === 1 ? matches[0].id : undefined)
      if (typeof id === 'string' && id) entry.match.linkedInId = id
    })
  }
  return bound
}
