import { profileErrorDetails } from './errors.ts'
import type { JsonObject } from './input-types.ts'
import type { PlanStep, ProfileClient } from './plan-types.ts'
import { linkedInPayload } from './payloads.ts'
import { name, section } from './profile-data.ts'
import type { ProfileLogger } from './profile-logger.ts'
import { verifyProfile } from './verify.ts'
import { MCP_PROFILE_SKILLS_LIMIT } from './mcp-contract.ts'
import { prepareEducation, prepareExperience, type EntryPreparation } from './prepare-entry.ts'

type PreparedStep = EntryPreparation

function sections(step: PlanStep) {
  if (step.section === 'experience') return ['linkedin_experience', 'linkedin_skills']
  if (step.section === 'education') return ['linkedin_education', 'linkedin_skills']
  if (step.section === 'skills') return ['linkedin_skills']
  return []
}

function prepareSkills(profile: JsonObject, step: PlanStep): PreparedStep {
  const spec = step.verification
  if (spec.kind !== 'skills') return { mode: 'write', step }
  const current = new Set(section(profile, 'skills').map(name).filter(Boolean)
    .map(value => value!.toLowerCase()))
  const room = Math.max(0, MCP_PROFILE_SKILLS_LIMIT - current.size)
  const missing = spec.expected.filter(value => !current.has(value.toLowerCase())).slice(0, room)
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
    if (prepared.mode === 'write' && step.section === 'experience') {
      prepared = prepareExperience(profile, prepared.step)
    }
    if (prepared.mode === 'write' && step.section === 'education') {
      prepared = prepareEducation(profile, prepared.step)
    }
    if (prepared.omittedSkills) logger.event('entry_skills_omitted', 'succeeded', {
      stepId: step.id, section: step.section, issueCount: prepared.omittedSkills })
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
