import type { JsonObject, ProfileInput, ValidationIssue } from '../input-types.ts'
import type { PlanStep } from '../plan-types.ts'
import type { EntrySkillBudget } from '../entry-skill-budget.ts'
import { desiredEducation, normalizeEducation, section, sectionReadable } from '../profile-data.ts'
import { differs, educationMatches } from '../profile-match.ts'
import { educationPayload } from '../payloads.ts'

export function planEducation(
  desired: ProfileInput, current: JsonObject, issues: ValidationIssue[], budget?: EntrySkillBudget
): PlanStep[] {
  if (desired.education.length && !sectionReadable(current, 'education')) {
    issues.push({ level: 'warning', path: 'profile.education',
      message: 'Education прочитан не полностью.', resolution: 'Раздел пропущен.' })
    return []
  }
  const entries = section(current, 'education')
  return desired.education.flatMap((entry, index) => {
    const matches = entries.filter(item => educationMatches(item, entry.match))
    if (matches.length > 1) {
      issues.push({ level: 'warning', path: `profile.education[${index}]`,
        message: 'Найдено несколько совпадений.', resolution: 'Запись пропущена.' })
      return []
    }
    const existing = matches[0]
    const id = existing && typeof existing.id === 'string' ? existing.id : undefined
    if (existing && !id) {
      issues.push({ level: 'warning', path: `profile.education[${index}]`,
        message: 'У записи нет ID.', resolution: 'Запись пропущена.' })
      return []
    }
    if (!existing && !entry.data.startDate) {
      issues.push({ level: 'warning', path: `profile.education[${index}].data.start_date`,
        message: 'Unipile v2 requires start_date to create an Education.',
        resolution: 'This CV entry was skipped because the required fact is unavailable.' })
      return []
    }
    const before = existing ? normalizeEducation(existing) : undefined
    if (before && !differs(before, desiredEducation(entry.data))) return []
    const selected = budget?.take(entry.data.skills)
    const data = selected ? { ...entry.data, skills: selected.accepted } : entry.data
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
