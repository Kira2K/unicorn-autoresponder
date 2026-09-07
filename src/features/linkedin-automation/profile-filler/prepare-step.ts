import { profileErrorDetails } from './errors.ts'
import type { JsonObject } from './input-types.ts'
import type { PlanStep, ProfileClient, ProfilePlan } from './plan-types.ts'
import { linkedInPayload } from './payloads.ts'
import { name, section, sectionReadable } from './profile-data.ts'
import type { ProfileLogger } from './profile-logger.ts'
import { verifyProfile } from './verify.ts'
import { MCP_PROFILE_SKILLS_LIMIT } from './mcp-contract.ts'
import { prepareEducation, prepareExperience, type EntryPreparation } from './prepare-entry.ts'
import { codedError } from './errors.ts'
import { skillKey } from './skill-selection.ts'

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
    .map(value => skillKey(value!)))
  const room = Math.max(0, MCP_PROFILE_SKILLS_LIMIT - current.size)
  const missing = spec.expected.filter(value => !current.has(skillKey(value)))
  if (missing.length > room) throw codedError('profile_preview_stale',
    'The approved Skills no longer fit; build a fresh Preview.')
  if (!missing.length) return { mode: 'skip', step }
  return { mode: 'write', step: { ...step,
    payload: linkedInPayload('skills', missing.map(name => ({ name }))),
    verification: spec } }
}

export async function prepareStep(client: ProfileClient, accountId: string, step: PlanStep,
  logger: ProfileLogger, policy?: ProfilePlan['skillPolicy']): Promise<PreparedStep> {
  logger.event('prewrite_check', 'started', { stepId: step.id, section: step.section })
  try {
    const profile = await client.getOwnProfile(accountId, sections(step), { fresh: true })
    for (const key of sections(step).map(value => value.replace('linkedin_', ''))) {
      if (!sectionReadable(profile, key)) throw codedError('profile_section_unavailable',
        `The ${key} section is unavailable; no write is allowed.`)
    }
    if (policy && sections(step).includes('linkedin_skills')) {
      const current = new Set(section(profile, 'skills').map(name).filter(Boolean).map(value => skillKey(value!)))
      const allowed = new Set(policy.target.map(skillKey))
      if (policy.baseline.some(value => !current.has(skillKey(value))) ||
        [...current].some(value => !allowed.has(value))) throw codedError('profile_preview_stale',
        'Skills changed outside the approved plan; build a fresh Preview.')
    }
    if (step.readOnly && !verifyProfile(profile, step.verification)) {
      throw codedError('profile_verification_mismatch', 'The complete Skills set does not match Preview.')
    }
    if (['experience', 'education'].includes(step.section)) {
      const spec = step.verification
      if (spec.kind === 'experience' || spec.kind === 'education') {
        const all = new Set([...section(profile, 'skills').map(name).filter(Boolean),
          ...spec.expected.skills].map(value => String(value).normalize('NFKC').trim().toLowerCase()))
        if (all.size > MCP_PROFILE_SKILLS_LIMIT) throw codedError('profile_preview_stale',
          'The approved entry Skills no longer fit; build a fresh Preview.')
      }
    }
    let prepared = verifyProfile(profile, step.verification)
      ? { mode: 'skip' as const, step } : prepareSkills(profile, step)
    if (prepared.mode === 'write' && step.section === 'experience') {
      prepared = prepareExperience(profile, prepared.step)
    }
    if (prepared.mode === 'write' && step.section === 'education') {
      prepared = prepareEducation(profile, prepared.step)
    }
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
