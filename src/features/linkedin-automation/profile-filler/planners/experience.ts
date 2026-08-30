import type { JsonObject, ProfileInput, ValidationIssue } from '../input-types.ts'
import type { PlanStep } from '../plan-types.ts'
import type { EntrySkillBudget } from '../entry-skill-budget.ts'
import { desiredExperience, normalizeExperience, section, sectionReadable } from '../profile-data.ts'
import { differs, experienceMatches } from '../profile-match.ts'
import { experiencePayload } from '../payloads.ts'

export function planExperience(
  desired: ProfileInput, current: JsonObject, issues: ValidationIssue[], budget?: EntrySkillBudget
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
        resolution: 'This CV entry was skipped because the required fact is unavailable.' })
      return []
    }
    const before = existing ? normalizeExperience(existing) : undefined
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
