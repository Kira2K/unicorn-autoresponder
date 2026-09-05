import { codedError } from './errors.ts'
import type { JsonObject, ValidationIssue } from './input-types.ts'
import type { PlanStep } from './plan-types.ts'
import { educationPayload, experiencePayload } from './payloads.ts'
import {
  desiredEducation, desiredExperience, normalizeEducation, normalizeExperience
} from './profile-data.ts'
import { differs } from './profile-match.ts'
import { entryCandidates } from './entry-target.ts'
import { validateEntryDates } from './date-policy.ts'

export type EntryPreparation = {
  mode: 'skip' | 'write'; step: PlanStep
}

const missing = (kind: string) => codedError('profile_entry_missing', `${kind} entry is missing.`)
const noId = (kind: string) => codedError('profile_entry_id_missing', `${kind} entry has no ID.`)
const ambiguous = (kind: string) => codedError('profile_entry_ambiguous',
  `Multiple ${kind} entries match.`)

function assertCurrentStatus(data: { isCurrent?: boolean }, before: JsonObject) {
  if (data.isCurrent && before.end_date != null) throw codedError('profile_current_status_unsupported',
    'The current entry still has an end date. Mark it as current in LinkedIn and rebuild Preview.')
}

export function prepareExperience(profile: JsonObject, step: PlanStep): EntryPreparation {
  const spec = step.verification
  if (spec.kind !== 'experience') return { mode: 'write', step }
  const matches = entryCandidates(profile, spec)
  if (matches.length > 1) throw ambiguous('Experience')
  if (!matches.length) {
    if (step.action === 'update') throw missing('Experience')
    const issues: ValidationIssue[] = []
    if (!validateEntryDates(spec.expected, undefined, 'experience', issues)) throw missing('Experience date')
    return { mode: 'write', step }
  }
  const existing = matches[0]; const id = typeof existing.id === 'string' ? existing.id : ''
  if (!id) throw noId('Experience')
  const before = normalizeExperience(existing); const after = desiredExperience(spec.expected)
  assertCurrentStatus(spec.expected, before)
  if (!differs(before, after)) return { mode: 'skip', step }
  if (!spec.id || !step.before || differs(before, step.before as JsonObject)) {
    throw codedError('profile_preview_stale', 'Experience changed; build a fresh Preview before writing.')
  }
  return { mode: 'write', step: { ...step, action: 'update',
    before, after, payload: experiencePayload(spec.expected, id, before),
    verification: { ...spec, id, expected: spec.expected } } }
}

export function prepareEducation(profile: JsonObject, step: PlanStep): EntryPreparation {
  const spec = step.verification
  if (spec.kind !== 'education') return { mode: 'write', step }
  const matches = entryCandidates(profile, spec)
  if (matches.length > 1) throw ambiguous('Education')
  if (!matches.length) {
    if (step.action === 'update') throw missing('Education')
    const issues: ValidationIssue[] = []
    if (!validateEntryDates(spec.expected, undefined, 'education', issues)) throw missing('Education date')
    return { mode: 'write', step }
  }
  const existing = matches[0]; const id = typeof existing.id === 'string' ? existing.id : ''
  if (!id) throw noId('Education')
  const before = normalizeEducation(existing); const after = desiredEducation(spec.expected)
  assertCurrentStatus(spec.expected, before)
  if (!differs(before, after)) return { mode: 'skip', step }
  if (!spec.id || !step.before || differs(before, step.before as JsonObject)) {
    throw codedError('profile_preview_stale', 'Education changed; build a fresh Preview before writing.')
  }
  return { mode: 'write', step: { ...step, action: 'update',
    before, after, payload: educationPayload(spec.expected, id, before),
    verification: { ...spec, id, expected: spec.expected } } }
}
