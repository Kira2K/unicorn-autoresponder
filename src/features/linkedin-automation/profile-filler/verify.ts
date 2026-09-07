import type { JsonObject } from './input-types.ts'
import type { PlanStep, ProfileClient, VerificationSpec } from './plan-types.ts'
import {
  desiredEducation, desiredExperience, normalizeEducation, normalizeExperience, section, specifics
} from './profile-data.ts'
import { differs } from './profile-match.ts'
import { entryTarget } from './entry-target.ts'
import { skillKey } from './skill-selection.ts'

function nestedMatch(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) &&
    expected.every(value => actual.some(item => nestedMatch(item, value)))
  if (expected && typeof expected === 'object') return Boolean(actual && typeof actual === 'object') &&
    Object.entries(expected).every(([key, value]) => nestedMatch((actual as JsonObject)[key], value))
  return Object.is(actual, expected)
}

function sectionsFor(spec: VerificationSpec) {
  if (spec.kind === 'experience') return ['linkedin_experience']
  if (spec.kind === 'education') return ['linkedin_education']
  if (spec.kind === 'skills') return ['linkedin_skills']
  return []
}

export function verifyProfile(profile: JsonObject, spec: VerificationSpec): boolean {
  if (spec.kind === 'headline') return String(profile.description ?? '') === spec.expected
  if (spec.kind === 'about') return String(profile.bio ?? '') === spec.expected
  if (spec.kind === 'skills') {
    const names = new Set(section(profile, 'skills').map(item =>
      skillKey(String(item.name ?? item.title ?? ''))))
    return spec.expected.every(value => names.has(skillKey(value))) &&
      (!spec.exact || names.size === new Set(spec.expected.map(skillKey)).size)
  }
  if (spec.kind === 'experience') {
    const target = entryTarget(profile, spec)
    return Boolean(target) && !differs(normalizeExperience(target!), desiredExperience(spec.expected))
  }
  if (spec.kind === 'education') {
    const target = entryTarget(profile, spec)
    return Boolean(target) && !differs(normalizeEducation(target!), desiredEducation(spec.expected))
  }
  const data = specifics(profile)
  return data.is_open_to_work === true && nestedMatch(data.open_to_work, spec.expected)
}

export async function readBack(client: ProfileClient, accountId: string, step: PlanStep) {
  return verifyProfile(await client.getOwnProfile(accountId, sectionsFor(step.verification),
    { fresh: true }), step.verification)
}
