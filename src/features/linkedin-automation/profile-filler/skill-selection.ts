import type { JsonObject, ProfileInput, ValidationIssue } from './input-types.ts'
import { name, section } from './profile-data.ts'

export const skillKey = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
export function uniqueSkills(values: string[]) {
  return [...new Map(values.filter(value => skillKey(value)).map(value => [skillKey(value), value])).values()]
}

export function selectProfileSkills(input: ProfileInput, current: JsonObject, issues: ValidationIssue[]) {
  const desired = structuredClone(input)
  const existing = uniqueSkills(section(current, 'skills').map(name).filter((item): item is string => Boolean(item)))
  const attached = [...desired.experience, ...desired.education].flatMap(entry => entry.data.skills)
  const target = uniqueSkills([...existing, ...attached, ...desired.skills.add]).slice(0, 100)
  const allowed = new Set(target.map(skillKey))
  const requested = uniqueSkills([...attached, ...desired.skills.add])
  const omitted = requested.filter(value => !allowed.has(skillKey(value)))
  // Candidate alternatives beyond the available slots are not promised additions.
  const omittedAttached = uniqueSkills(attached).filter(value => !allowed.has(skillKey(value)))
  const report = existing.length >= 100 ? omitted : omittedAttached
  if (report.length) issues.push({ level: 'warning', path: 'profile.skills.omitted',
    message: `Skills not applied because the 100-Skill limit is reached: ${report.join(', ')}.`,
    suggestions: report, resolution: 'Other fields can be applied; the result will be partially completed.' })
  for (const entry of [...desired.experience, ...desired.education]) {
    entry.data.skills = uniqueSkills(entry.data.skills).filter(value => allowed.has(skillKey(value)))
  }
  if (input.skills.add.length || attached.length) desired.skills.add = target
  return desired
}

export function hasOmittedSkills(issues: ValidationIssue[]) {
  return issues.some(issue => issue.path === 'profile.skills.omitted')
}
