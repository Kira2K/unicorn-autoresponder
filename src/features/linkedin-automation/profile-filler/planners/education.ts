import type { JsonObject, ProfileInput, ValidationIssue } from '../input-types.ts'
import type { PlanStep } from '../plan-types.ts'
import { desiredEducation, normalizeEducation, section, sectionReadable } from '../profile-data.ts'
import { differs, educationMatches } from '../profile-match.ts'
import { educationPayload } from '../payloads.ts'

export function planEducation(
  desired: ProfileInput, current: JsonObject, issues: ValidationIssue[]
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
        resolution: 'Add start_date in YYYY-MM format and rebuild Preview.' })
      return []
    }
    const after = desiredEducation(entry.data)
    if (existing && !differs(normalizeEducation(existing), after)) return []
    return [{
      id: `education-${index + 1}`, section: 'education' as const,
      action: existing ? 'update' as const : 'create' as const,
      summary: `${existing ? 'Обновить' : 'Создать'} Education: ${entry.data.school}`,
      before: existing ? normalizeEducation(existing) : null, after,
      payload: educationPayload(entry.data, id),
      verification: { kind: 'education' as const, id, expected: entry.data }
    }]
  })
}
