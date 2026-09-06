import type { JsonObject, ProfileInput } from './input-types.ts'
import type { ProfilePlan } from './plan-types.ts'
import { name, section, sectionReadable, normalizeEducation, normalizeExperience } from './profile-data.ts'
import { codedError } from './errors.ts'
import { skillKey } from './skill-selection.ts'

type EntrySection = 'experience' | 'education'
export type ApprovedEntries = Partial<Record<EntrySection, JsonObject[]>>

function entries(profile: JsonObject, key: EntrySection) {
  const normalize = key === 'experience' ? normalizeExperience : normalizeEducation
  return section(profile, key).map(item => ({ id: item.id, ...normalize(item) }))
}

function signature(items: JsonObject[]) {
  return items.map(item => JSON.stringify({ ...item,
    skills: Array.isArray(item.skills) ? item.skills.map(value => skillKey(String(value))).sort() : []
  })).sort().join('\n')
}

export function captureApprovedEntries(input: ProfileInput, profile: JsonObject): ApprovedEntries {
  return Object.fromEntries((['experience', 'education'] as const)
    .filter(key => input[key].length).map(key => [key, entries(profile, key)]))
}

export function approvedSections(plan: ProfilePlan) {
  return [...Object.keys(plan.entryPolicy ?? {}).map(key => `linkedin_${key}`),
    ...(plan.skillPolicy ? ['linkedin_skills'] : [])]
}

export function assertApprovedState(plan: ProfilePlan, profile: JsonObject) {
  const stale = () => codedError('profile_preview_stale', 'The approved profile changed; build a new Preview.')
  for (const [key, baseline] of Object.entries(plan.entryPolicy ?? {})) {
    if (!sectionReadable(profile, key)) throw codedError('profile_section_unavailable',
      `The ${key} section is unavailable; Apply is blocked.`)
    if (signature(entries(profile, key as EntrySection)) !== signature(baseline)) throw stale()
  }
  if (!plan.skillPolicy) return
  if (!sectionReadable(profile, 'skills')) throw codedError('profile_section_unavailable',
    'Skills are unavailable; Apply is blocked.')
  const actual = new Set(section(profile, 'skills').map(name).filter(Boolean).map(value => skillKey(value!)))
  const expected = new Set(plan.skillPolicy.baseline.map(skillKey))
  if (actual.size !== expected.size || [...expected].some(value => !actual.has(value))) throw stale()
}
