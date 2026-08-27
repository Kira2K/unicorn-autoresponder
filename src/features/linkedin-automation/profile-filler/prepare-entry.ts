import { codedError } from './errors.ts'
import { createEntrySkillBudget } from './entry-skill-budget.ts'
import type { JsonObject } from './input-types.ts'
import type { PlanStep } from './plan-types.ts'
import { educationPayload, experiencePayload } from './payloads.ts'
import {
  desiredEducation, desiredExperience, normalizeEducation, normalizeExperience, section
} from './profile-data.ts'
import { differs, educationMatches, experienceMatches } from './profile-match.ts'

export type EntryPreparation = {
  mode: 'skip' | 'write'; step: PlanStep; omittedSkills?: number
}

const missing = (kind: string) => codedError('profile_entry_missing', `${kind} entry is missing.`)
const noId = (kind: string) => codedError('profile_entry_id_missing', `${kind} entry has no ID.`)
const ambiguous = (kind: string) => codedError('profile_entry_ambiguous',
  `Multiple ${kind} entries match.`)

function safeData(profile: JsonObject, data: any) {
  const selected = createEntrySkillBudget(profile).take(data.skills)
  return { data: { ...data, skills: selected.accepted }, omittedSkills: selected.blocked.length }
}

export function prepareExperience(profile: JsonObject, step: PlanStep): EntryPreparation {
  const spec = step.verification
  if (spec.kind !== 'experience') return { mode: 'write', step }
  const safe = safeData(profile, spec.expected)
  const matches = section(profile, 'experience').filter(item => spec.id
    ? item.id === spec.id : experienceMatches(item, { company: spec.expected.company,
      jobTitle: spec.expected.jobTitle, startDate: spec.expected.startDate }))
  if (matches.length > 1) throw ambiguous('Experience')
  if (!matches.length) {
    if (step.action === 'update') throw missing('Experience')
    return { mode: 'write', omittedSkills: safe.omittedSkills, step: { ...step,
      after: desiredExperience(safe.data), payload: experiencePayload(safe.data),
      verification: { ...spec, expected: safe.data } } }
  }
  const existing = matches[0]; const id = typeof existing.id === 'string' ? existing.id : ''
  if (!id) throw noId('Experience')
  const before = normalizeExperience(existing); const after = desiredExperience(safe.data)
  if (!differs(before, after)) return { mode: 'skip', step, omittedSkills: safe.omittedSkills }
  return { mode: 'write', omittedSkills: safe.omittedSkills, step: { ...step, action: 'update',
    before, after, payload: experiencePayload(safe.data, id, before),
    verification: { ...spec, id, expected: safe.data } } }
}

export function prepareEducation(profile: JsonObject, step: PlanStep): EntryPreparation {
  const spec = step.verification
  if (spec.kind !== 'education') return { mode: 'write', step }
  const safe = safeData(profile, spec.expected)
  const matches = section(profile, 'education').filter(item => spec.id
    ? item.id === spec.id : educationMatches(item,
      { school: spec.expected.school, startDate: spec.expected.startDate }))
  if (matches.length > 1) throw ambiguous('Education')
  if (!matches.length) {
    if (step.action === 'update') throw missing('Education')
    return { mode: 'write', omittedSkills: safe.omittedSkills, step: { ...step,
      after: desiredEducation(safe.data), payload: educationPayload(safe.data),
      verification: { ...spec, expected: safe.data } } }
  }
  const existing = matches[0]; const id = typeof existing.id === 'string' ? existing.id : ''
  if (!id) throw noId('Education')
  const before = normalizeEducation(existing); const after = desiredEducation(safe.data)
  if (!differs(before, after)) return { mode: 'skip', step, omittedSkills: safe.omittedSkills }
  return { mode: 'write', omittedSkills: safe.omittedSkills, step: { ...step, action: 'update',
    before, after, payload: educationPayload(safe.data, id, before),
    verification: { ...spec, id, expected: safe.data } } }
}
