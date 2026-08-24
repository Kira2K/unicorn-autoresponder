import type { JsonObject, ProfileInput, ValidationIssue } from '../input-types.ts'
import type { PlanStep } from '../plan-types.ts'
import { name, section, sectionReadable } from '../profile-data.ts'
import { linkedInPayload } from '../payloads.ts'

export function planSkills(
  desired: ProfileInput, current: JsonObject, issues: ValidationIssue[]
): PlanStep[] {
  if (desired.skills.add.length && !sectionReadable(current, 'skills')) {
    issues.push({ level: 'warning', path: 'profile.skills',
      message: 'Skills прочитаны не полностью.', resolution: 'Раздел пропущен.' })
    return []
  }
  const currentNames = section(current, 'skills').map(name).filter((value): value is string => Boolean(value))
  if (currentNames.length > 103) {
    issues.push({ level: 'warning', path: 'profile.skills',
      message: `В профиле уже ${currentNames.length} Skills.`, resolution: 'Skills не изменяются.' })
    return []
  }
  const currentKeys = new Set(currentNames.map(value => value.toLowerCase()))
  const room = Math.max(0, desired.skills.targetCount - currentNames.length)
  const requestedMissing = desired.skills.add.filter(value => !currentKeys.has(value.toLowerCase()))
  const missing = requestedMissing.slice(0, room)
  if (!room && requestedMissing.length) {
    issues.push({ level: 'warning', path: 'profile.skills.add',
      message: `В профиле уже ${currentNames.length} Skills; ${requestedMissing.length} из JSON отсутствуют.`,
      resolution: 'Автоматическая замена или удаление Skills пока не поддерживается.' })
  }
  if (currentNames.length + missing.length < 95 && desired.skills.add.length) {
    issues.push({ level: 'warning', path: 'profile.skills.add',
      message: 'После добавления будет меньше 95 Skills.', resolution: 'Дополните исходный список.' })
  }
  const steps: PlanStep[] = []
  for (let offset = 0; offset < missing.length; offset += 10) {
    const batch = missing.slice(offset, offset + 10)
    steps.push({
      id: `skills-${offset / 10 + 1}`, section: 'skills', action: 'add',
      summary: `Добавить Skills: ${batch.join(', ')}`,
      before: { count: currentNames.length + offset },
      after: { count: currentNames.length + offset + batch.length, added: batch },
      payload: linkedInPayload('skills', batch.map(value => ({ name: value }))),
      verification: { kind: 'skills', expected: batch }
    })
  }
  return steps
}
