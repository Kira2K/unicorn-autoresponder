import type { JsonObject } from './input-types.ts'
import type { PlanStep, ProfileClient } from './plan-types.ts'
import { normalizeEducation, normalizeExperience, section, specifics } from './profile-data.ts'
import { differs, educationMatches, experienceMatches } from './profile-match.ts'
import { verifyProfile } from './verify.ts'

export type Observation = 'matched' | 'unchanged' | 'mismatch'

function same(current: JsonObject, before: unknown) {
  return Boolean(before && typeof before === 'object' && !differs(current, before as JsonObject))
}

function experienceTarget(profile: JsonObject, step: PlanStep) {
  const items = section(profile, 'experience')
  const spec = step.verification
  if (spec.kind !== 'experience') return undefined
  if (spec.id) return items.find(item => item.id === spec.id)
  return items.find(item => experienceMatches(item, {
    company: spec.expected.company, jobTitle: spec.expected.jobTitle,
    startDate: spec.expected.startDate
  }))
}

function educationTarget(profile: JsonObject, step: PlanStep) {
  const items = section(profile, 'education')
  const spec = step.verification
  if (spec.kind !== 'education') return undefined
  if (spec.id) return items.find(item => item.id === spec.id)
  return items.find(item => educationMatches(item, {
    school: spec.expected.school, startDate: spec.expected.startDate
  }))
}

export function observeProfile(profile: JsonObject, step: PlanStep): Observation {
  if (verifyProfile(profile, step.verification)) return 'matched'
  if (step.verification.kind === 'headline') {
    return String(profile.description ?? '') === String(step.before ?? '') ? 'unchanged' : 'mismatch'
  }
  if (step.verification.kind === 'about') {
    return String(profile.bio ?? '') === String(step.before ?? '') ? 'unchanged' : 'mismatch'
  }
  if (step.verification.kind === 'experience') {
    const target = experienceTarget(profile, step)
    return !target ? 'unchanged' : same(normalizeExperience(target), step.before) ? 'unchanged' : 'mismatch'
  }
  if (step.verification.kind === 'education') {
    const target = educationTarget(profile, step)
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
  return observeProfile(await client.getOwnProfile(accountId, sections), step)
}

export async function observeSteps(client: ProfileClient, accountId: string, steps: PlanStep[]) {
  const sections = [...new Set(steps.flatMap(step => step.section === 'experience' ? ['linkedin_experience'] :
    step.section === 'education' ? ['linkedin_education'] :
      step.section === 'skills' ? ['linkedin_skills'] : []))]
  const profile = await client.getOwnProfile(accountId, sections)
  return steps.map(step => observeProfile(profile, step))
}
