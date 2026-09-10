import type { JsonObject } from './input-types.ts'
import type { VerificationSpec } from './plan-types.ts'
import { section } from './profile-data.ts'
import { educationCandidates, experienceCandidates } from './profile-match.ts'
import { codedError } from './errors.ts'

export function entryCandidates(profile: JsonObject, spec: VerificationSpec): JsonObject[] {
  if (spec.kind !== 'experience' && spec.kind !== 'education') return []
  const entries = section(profile, spec.kind)
  if (spec.id) return entries.filter(item => item.id === spec.id)
  if (spec.kind === 'experience') {
    const data = spec.expected
    if (!data.company || !data.jobTitle) throw codedError('profile_entry_identity_missing', 'Experience identity is missing.')
    const complete = { ...data, company: data.company, jobTitle: data.jobTitle }
    return experienceCandidates(entries, { match: complete, data: complete })
  }
  const data = spec.expected
  if (!data.school) throw codedError('profile_entry_identity_missing', 'Education identity is missing.')
  const complete = { ...data, school: data.school }
  return educationCandidates(entries, { match: complete, data: complete })
}

export function entryTarget(profile: JsonObject, spec: VerificationSpec) {
  const matches = entryCandidates(profile, spec)
  if (matches.length > 1) throw codedError('profile_entry_ambiguous',
    'Multiple entries match the approved CV fact; a new Preview is required.')
  return matches[0]
}
