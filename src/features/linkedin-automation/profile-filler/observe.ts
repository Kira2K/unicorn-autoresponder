import type { JsonObject } from './input-types.ts'
import type { PlanStep, ProfileClient } from './plan-types.ts'
import { normalizeEducation, normalizeExperience, section, sectionReadable, specifics } from './profile-data.ts'
import { differs } from './profile-match.ts'
import { verifyProfile } from './verify.ts'
import { entryTarget } from './entry-target.ts'

export type Observation = 'matched' | 'unchanged' | 'mismatch' | 'unavailable'

function readable(profile: JsonObject, step: PlanStep) {
  if (step.section === 'experience') return sectionReadable(profile, 'experience')
  if (step.section === 'education') return sectionReadable(profile, 'education')
  if (step.section === 'skills') return sectionReadable(profile, 'skills')
  if (step.section === 'about') return typeof profile.bio === 'string'
  if (step.section === 'headline') return typeof profile.description === 'string'
  return true
}

function same(current: JsonObject, before: unknown) {
  return Boolean(before && typeof before === 'object' && !differs(current, before as JsonObject))
}

export function observeProfile(profile: JsonObject, step: PlanStep): Observation {
  if (!readable(profile, step)) return 'unavailable'
  if (verifyProfile(profile, step.verification)) return 'matched'
  if (step.verification.kind === 'headline') {
    return String(profile.description ?? '') === String(step.before ?? '') ? 'unchanged' : 'mismatch'
  }
  if (step.verification.kind === 'about') {
    return String(profile.bio ?? '') === String(step.before ?? '') ? 'unchanged' : 'mismatch'
  }
  if (step.verification.kind === 'experience') {
    const target = entryTarget(profile, step.verification)
    return !target ? 'unchanged' : same(normalizeExperience(target), step.before) ? 'unchanged' : 'mismatch'
  }
  if (step.verification.kind === 'education') {
    const target = entryTarget(profile, step.verification)
    return !target ? 'unchanged' : same(normalizeEducation(target), step.before) ? 'unchanged' : 'mismatch'
  }
  if (step.verification.kind === 'skills') {
    const names = new Set(section(profile, 'skills').map(item => String(item.name ?? '').toLowerCase()))
    return step.verification.expected.some(value => names.has(value.toLowerCase())) ? 'mismatch' : 'unchanged'
  }
  const current = specifics(profile).open_to_work
  return JSON.stringify(current ?? null) === JSON.stringify(step.before ?? null) ? 'unchanged' : 'mismatch'
}

export async function observeReadBack(client: ProfileClient, accountId: string, step: PlanStep) {
  const sections = step.section === 'experience' ? ['linkedin_experience'] :
    step.section === 'education' ? ['linkedin_education'] :
      step.section === 'skills' ? ['linkedin_skills'] : []
  return observeProfile(await client.getOwnProfile(accountId, sections, { fresh: true }), step)
}

export async function observeSteps(client: ProfileClient, accountId: string, steps: PlanStep[]) {
  const sections = [...new Set(steps.flatMap(step => step.section === 'experience' ? ['linkedin_experience'] :
    step.section === 'education' ? ['linkedin_education'] :
      step.section === 'skills' ? ['linkedin_skills'] : []))]
  const profile = await client.getOwnProfile(accountId, sections, { fresh: true })
  return steps.map(step => observeProfile(profile, step))
}
