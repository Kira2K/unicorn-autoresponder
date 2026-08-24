import { codedError, profileErrorDetails } from './errors.ts'
import type { JsonObject } from './input-types.ts'
import type { PlanStep, ProfileClient } from './plan-types.ts'
import { educationPayload, experiencePayload, linkedInPayload } from './payloads.ts'
import {
  desiredEducation, desiredExperience, name, normalizeEducation, normalizeExperience, section
} from './profile-data.ts'
import { differs, educationMatches, experienceMatches } from './profile-match.ts'
import type { ProfileLogger } from './profile-logger.ts'
import { verifyProfile } from './verify.ts'

type PreparedStep = { mode: 'skip' | 'write'; step: PlanStep }

function sections(step: PlanStep) {
  if (step.section === 'experience') return ['linkedin_experience']
  if (step.section === 'education') return ['linkedin_education']
  if (step.section === 'skills') return ['linkedin_skills']
  return []
}

function entryError(code: string, message: string) {
  return codedError(code, message)
}

function prepareExperience(profile: JsonObject, step: PlanStep): PreparedStep {
  const spec = step.verification
  if (step.action !== 'create' || spec.kind !== 'experience') return { mode: 'write', step }
  const matches = section(profile, 'experience').filter(item => experienceMatches(item, {
    company: spec.expected.company, jobTitle: spec.expected.jobTitle,
    startDate: spec.expected.startDate
  }))
  if (matches.length > 1) throw entryError('profile_entry_ambiguous', 'Multiple Experience entries match.')
  if (!matches.length) return { mode: 'write', step }
  const existing = matches[0]
  const id = typeof existing.id === 'string' ? existing.id : ''
  if (!id) throw entryError('profile_entry_id_missing', 'Existing Experience has no ID.')
  if (!differs(normalizeExperience(existing), desiredExperience(spec.expected))) {
    return { mode: 'skip', step }
  }
  return { mode: 'write', step: { ...step, action: 'update', before: normalizeExperience(existing),
    payload: experiencePayload(spec.expected, id), verification: { ...spec, id } } }
}

function prepareEducation(profile: JsonObject, step: PlanStep): PreparedStep {
  const spec = step.verification
  if (step.action !== 'create' || spec.kind !== 'education') return { mode: 'write', step }
  const matches = section(profile, 'education').filter(item => educationMatches(item, {
    school: spec.expected.school, startDate: spec.expected.startDate
  }))
  if (matches.length > 1) throw entryError('profile_entry_ambiguous', 'Multiple Education entries match.')
  if (!matches.length) return { mode: 'write', step }
  const existing = matches[0]
  const id = typeof existing.id === 'string' ? existing.id : ''
  if (!id) throw entryError('profile_entry_id_missing', 'Existing Education has no ID.')
  if (!differs(normalizeEducation(existing), desiredEducation(spec.expected))) {
    return { mode: 'skip', step }
  }
  return { mode: 'write', step: { ...step, action: 'update', before: normalizeEducation(existing),
    payload: educationPayload(spec.expected, id), verification: { ...spec, id } } }
}

function prepareSkills(profile: JsonObject, step: PlanStep): PreparedStep {
  const spec = step.verification
  if (spec.kind !== 'skills') return { mode: 'write', step }
  const current = new Set(section(profile, 'skills').map(name).filter(Boolean)
    .map(value => value!.toLowerCase()))
  const missing = spec.expected.filter(value => !current.has(value.toLowerCase()))
  if (!missing.length) return { mode: 'skip', step }
  return { mode: 'write', step: { ...step,
    payload: linkedInPayload('skills', missing.map(value => ({ name: value }))),
    verification: { kind: 'skills', expected: missing } } }
}

export async function prepareStep(client: ProfileClient, accountId: string, step: PlanStep,
  logger: ProfileLogger): Promise<PreparedStep> {
  logger.event('prewrite_check', 'started', { stepId: step.id, section: step.section })
  try {
    const profile = await client.getOwnProfile(accountId, sections(step))
    let prepared = verifyProfile(profile, step.verification)
      ? { mode: 'skip' as const, step } : prepareSkills(profile, step)
    if (prepared.mode === 'write') prepared = prepareExperience(profile, prepared.step)
    if (prepared.mode === 'write') prepared = prepareEducation(profile, prepared.step)
    logger.event('prewrite_check', 'succeeded', { stepId: step.id, section: step.section,
      observation: prepared.mode === 'skip' ? 'matched' : 'unchanged',
      operation: prepared.step.action })
    return prepared
  } catch (error) {
    logger.event('prewrite_check', 'failed', { stepId: step.id, section: step.section,
      ...profileErrorDetails(error) })
    throw error
  }
}
