import type { JsonObject, ProfileInput, ValidationIssue } from '../input-types.ts'
import type { PlanStep } from '../plan-types.ts'
import type { EntrySkillBudget } from '../entry-skill-budget.ts'
import { desiredExperience, normalizeExperience, section, sectionReadable } from '../profile-data.ts'
import { differs, experienceCandidates, experienceMatches } from '../profile-match.ts'
import { validateEntryDates } from '../date-policy.ts'
import { experiencePayload } from '../payloads.ts'
import { sharedEntryTargets } from '../entry-claims.ts'

export function planExperience(
  desired: ProfileInput, current: JsonObject, issues: ValidationIssue[], budget?: EntrySkillBudget
): PlanStep[] {
  if (desired.experience.length && !sectionReadable(current, 'experience')) {
    issues.push({ level: 'fatal', path: 'profile.experience',
      message: 'LinkedIn Experience is temporarily unavailable.',
      resolution: 'Wait for the section to become readable, then rebuild Preview.' })
    return []
  }
  const entries = section(current, 'experience')
  const shared = sharedEntryTargets(entries, desired.experience, experienceCandidates)
  const unmatched = entries.filter(item => !desired.experience.some(entry =>
    experienceCandidates([item], entry).length))
  if (unmatched.length) issues.push({ level: 'warning', path: 'profile.experience.unmatched',
    message: `${unmatched.length} existing Experience entries are outside this CV plan and will be preserved.`,
    resolution: 'Review these entries separately; Profile Filler will not delete them.' })
  return desired.experience.flatMap((entry, index) => {
    if (shared.has(index)) {
      issues.push({ level: 'fatal', path: `profile.experience[${index}].match`,
        message: 'Several CV records target the same LinkedIn Experience entry.',
        resolution: 'Resolve the ambiguous employment before Apply.' })
      return []
    }
    const matches = experienceCandidates(entries, entry)
    if (matches.length > 1) {
      issues.push({ level: 'fatal', path: `profile.experience[${index}]`,
        message: 'Multiple existing Experience entries match this CV fact.',
        resolution: 'Resolve the duplicate before Apply.' })
      return []
    }
    const existing = matches[0]
    if (existing && !experienceMatches(existing, entry.match)) {
      issues.push({ level: 'fatal', path: `profile.experience[${index}].match`,
        message: 'An existing Experience only partially matches this CV fact.',
        resolution: 'Resolve the company, role or date difference before Apply; do not create a possible duplicate.' })
      return []
    }
    const id = existing && typeof existing.id === 'string' ? existing.id : undefined
    if (existing && !id) {
      issues.push({ level: 'fatal', path: `profile.experience[${index}]`,
        message: 'The existing Experience entry has no stable LinkedIn ID.',
        resolution: 'Refresh the profile before Apply.' })
      return []
    }
    if (!existing && !entry.data.startDate) {
      issues.push({ level: 'fatal', path: `profile.experience[${index}].data.start_date`,
        message: 'Unipile v2 requires start_date to create an Experience.',
        resolution: 'Add the missing date to the approved CV and regenerate.' })
      return []
    }
    const before = existing ? normalizeExperience(existing) : undefined
    if (!validateEntryDates(entry.data, before, `profile.experience[${index}]`, issues)) return []
    if (before && !differs(before, desiredExperience(entry.data))) return []
    const selected = budget?.take(entry.data.skills)
    const data = selected ? { ...entry.data, skills: selected.accepted } : entry.data
    if (selected?.blocked.length) issues.push({ level: 'warning',
      path: `profile.experience[${index}].data.skills`,
      message: `${selected.blocked.length} Experience Skills would exceed LinkedIn's 100-Skill limit.`,
      resolution: 'They remain in the draft but are omitted from this write.' })
    const after = desiredExperience(data)
    if (before && !differs(before, after)) return []
    return [{
      id: `experience-${index + 1}`, section: 'experience' as const,
      action: existing ? 'update' as const : 'create' as const,
      summary: `${existing ? 'Обновить' : 'Создать'} Experience: ${entry.data.company}`,
      before: before ?? null, after,
      payload: experiencePayload(data, id, before),
      verification: { kind: 'experience' as const, id, expected: data }
    }]
  })
}
