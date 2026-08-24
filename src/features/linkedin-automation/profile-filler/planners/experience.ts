import type { JsonObject, ProfileInput, ValidationIssue } from '../input-types.ts'
import type { PlanStep } from '../plan-types.ts'
import { desiredExperience, normalizeExperience, section, sectionReadable } from '../profile-data.ts'
import { differs, experienceMatches } from '../profile-match.ts'
import { experiencePayload } from '../payloads.ts'

export function planExperience(
  desired: ProfileInput, current: JsonObject, issues: ValidationIssue[]
): PlanStep[] {
  if (desired.experience.length && !sectionReadable(current, 'experience')) {
    issues.push({ level: 'warning', path: 'profile.experience',
      message: 'Experience прочитан не полностью.', resolution: 'Раздел пропущен.' })
    return []
  }
  const entries = section(current, 'experience')
  return desired.experience.flatMap((entry, index) => {
    const matches = entries.filter(item => experienceMatches(item, entry.match))
    if (matches.length > 1) {
      issues.push({ level: 'warning', path: `profile.experience[${index}]`,
        message: 'Найдено несколько совпадений.', resolution: 'Запись пропущена.' })
      return []
    }
    const existing = matches[0]
    const id = existing && typeof existing.id === 'string' ? existing.id : undefined
    if (existing && !id) {
      issues.push({ level: 'warning', path: `profile.experience[${index}]`,
        message: 'У записи нет ID.', resolution: 'Запись пропущена.' })
      return []
    }
    if (!existing && !entry.data.startDate) {
      issues.push({ level: 'warning', path: `profile.experience[${index}].data.start_date`,
        message: 'Unipile v2 requires start_date to create an Experience.',
        resolution: 'Add start_date in YYYY-MM format and rebuild Preview.' })
      return []
    }
    const after = desiredExperience(entry.data)
    if (existing && !differs(normalizeExperience(existing), after)) return []
    return [{
      id: `experience-${index + 1}`, section: 'experience' as const,
      action: existing ? 'update' as const : 'create' as const,
      summary: `${existing ? 'Обновить' : 'Создать'} Experience: ${entry.data.company}`,
      before: existing ? normalizeExperience(existing) : null, after,
      payload: experiencePayload(entry.data, id),
      verification: { kind: 'experience' as const, id, expected: entry.data }
    }]
  })
}
