import type { JsonObject, ProfileInput, ValidationIssue } from '../input-types.ts'
import type { PlanStep } from '../plan-types.ts'
import type { EntrySkillBudget } from '../entry-skill-budget.ts'
import { desiredEducation, normalizeEducation, section, sectionReadable } from '../profile-data.ts'
import { differs, educationCandidates } from '../profile-match.ts'
import { educationPayload } from '../payloads.ts'
import { validateEntryDates } from '../date-policy.ts'
import { sharedEntryTargets } from '../entry-claims.ts'
import { selectedEntry, requireSelectedIdentity, entrySelected } from '../field-selection.ts'

export function planEducation(
  desired: ProfileInput, current: JsonObject, issues: ValidationIssue[], budget?: EntrySkillBudget, disabled: string[] = []
): PlanStep[] {
  if (!desired.education.some((_, index) => entrySelected('education', index, disabled))) return []
  if (desired.education.length && !sectionReadable(current, 'education')) {
    issues.push({ level: 'fatal', path: 'profile.education',
      message: 'LinkedIn Education is temporarily unavailable.',
      resolution: 'Wait for the section to become readable, then rebuild Preview.' })
    return []
  }
  const entries = section(current, 'education')
  const shared = sharedEntryTargets(entries, desired.education, (items, entry) =>
    entrySelected('education', desired.education.indexOf(entry), disabled) ? educationCandidates(items, entry) : [])
  return desired.education.flatMap((entry, index) => {
    const selectedData = selectedEntry(entry.data, 'education', index, disabled)
    if (!selectedData) return []
    if (shared.has(index)) {
      issues.push({ level: 'fatal', path: `profile.education[${index}].match`,
        message: 'Several CV records target the same LinkedIn Education entry.',
        resolution: 'Resolve the ambiguous education before Apply; no entry will be overwritten.' })
      return []
    }
    const matches = educationCandidates(entries, entry)
    if (matches.length > 1) {
      issues.push({ level: 'fatal', path: `profile.education[${index}]`,
        message: 'Multiple existing Education entries match this CV fact.',
        resolution: 'Resolve the duplicate before Apply.' })
      return []
    }
    const existing = matches[0]
    if (!existing && entry.match.linkedInId) {
      issues.push({ level: 'fatal', path: `profile.education[${index}].match`,
        message: 'Выбранная запись образования больше не найдена в LinkedIn.',
        resolution: 'Подготовьте новый Preview. Другая запись не будет выбрана автоматически.' })
      return []
    }
    const id = existing && typeof existing.id === 'string' ? existing.id : undefined
    if (existing && !id) {
      issues.push({ level: 'fatal', path: `profile.education[${index}]`,
        message: 'The existing Education entry has no stable LinkedIn ID.',
        resolution: 'Refresh the profile before Apply.' })
      return []
    }
    if (!existing && !requireSelectedIdentity(selectedData, 'education', index, issues)) return []
    const before = existing ? normalizeEducation(existing) : undefined
    if (!validateEntryDates(selectedData, before, `profile.education[${index}]`, issues)) return []
    if (before && !differs(before, desiredEducation(selectedData))) return []
    const selected = budget?.take(selectedData.skills)
    const data = selected ? { ...selectedData, skills: selected.accepted } : selectedData
    if (selected?.blocked.length) issues.push({ level: 'warning',
      path: `profile.education[${index}].data.skills`,
      message: `${selected.blocked.length} Education Skills would exceed LinkedIn's 100-Skill limit.`,
      resolution: 'They remain in the draft but are omitted from this write.' })
    const after = desiredEducation(data)
    if (before && !differs(before, after)) return []
    return [{
      id: `education-${index + 1}`, section: 'education' as const,
      action: existing ? 'update' as const : 'create' as const,
      summary: `${existing ? 'Обновить' : 'Создать'} Education: ${entry.data.school}`,
      before: before ?? null, after,
      payload: educationPayload(data, id, before),
      verification: { kind: 'education' as const, id, expected: data }
    }]
  })
}
