import type { JsonObject, ProfileInput, ValidationIssue } from './input-types.ts'
import { name, section } from './profile-data.ts'
import { fieldDisabled } from './field-selection.ts'

export const skillKey = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
export function uniqueSkills(values: string[]) {
  return [...new Map(values.filter(value => skillKey(value)).map(value => [skillKey(value), value])).values()]
}

export function selectProfileSkills(input: ProfileInput, current: JsonObject, issues: ValidationIssue[], disabled: string[] = []) {
  const desired = structuredClone(input)
  for (const group of ['experience', 'education'] as const) desired[group].forEach((entry, index) => {
    if (fieldDisabled(disabled, `profile.${group}[${index}].data.skills`)) entry.data.skills = []
  })
  const skillsOff = fieldDisabled(disabled, 'profile.skills.add')
  const existing = uniqueSkills(section(current, 'skills').map(name).filter((item): item is string => Boolean(item)))
  const attached = [...desired.experience, ...desired.education].flatMap(entry => entry.data.skills)
  const target = skillsOff ? existing : uniqueSkills([...existing, ...attached, ...desired.skills.add]).slice(0, 100)
  const allowed = new Set(target.map(skillKey))
  // Previously omitted candidates may no longer be in input; retain only actual omissions.
  for (let index = issues.length - 1; index >= 0; index--) {
    const issue = issues[index]
    if (issue.path !== 'profile.skills.omitted' || !issue.suggestions?.length) continue
    const missing = issue.suggestions.filter(value => !allowed.has(skillKey(value)))
    if (!missing.length) issues.splice(index, 1)
    else if (missing.length !== issue.suggestions.length) Object.assign(issue, { suggestions: missing,
      message: `Не будут добавлены навыки: ${missing.join(', ')}.` })
  }
  const requested = uniqueSkills([...attached, ...desired.skills.add])
  const omitted = requested.filter(value => !allowed.has(skillKey(value)))
  // Candidate alternatives beyond the available slots are not promised additions.
  const omittedAttached = uniqueSkills(attached).filter(value => !allowed.has(skillKey(value)))
  const report = skillsOff ? omittedAttached : existing.length >= 100 ? omitted : omittedAttached
  if (report.length) issues.push({ level: 'warning', path: 'profile.skills.omitted',
    message: skillsOff ? `Добавление навыков выключено. Не будут привязаны новые навыки: ${report.join(', ')}.`
      : `Skills not applied because the 100-Skill limit is reached: ${report.join(', ')}.`,
    suggestions: report, resolution: 'Other fields can be applied; the result will be partially completed.' })
  for (const entry of [...desired.experience, ...desired.education]) {
    entry.data.skills = uniqueSkills(entry.data.skills).filter(value => allowed.has(skillKey(value)))
  }
  if (input.skills.add.length || attached.length) desired.skills.add = target
  if (skillsOff) desired.skills.add = []
  return desired
}

export function hasOmittedSkills(issues: ValidationIssue[]) {
  return issues.some(issue => issue.path === 'profile.skills.omitted')
}
