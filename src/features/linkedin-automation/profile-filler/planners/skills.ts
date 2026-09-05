import type { JsonObject, ProfileInput, ValidationIssue } from '../input-types.ts'
import type { PlanStep } from '../plan-types.ts'
import { name, section, sectionReadable } from '../profile-data.ts'
import { linkedInPayload } from '../payloads.ts'

const skillKey = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')

export function planSkills(
  desired: ProfileInput, current: JsonObject, issues: ValidationIssue[]
): PlanStep[] {
  if (desired.skills.add.length && !sectionReadable(current, 'skills')) {
    issues.push({ level: 'fatal', path: 'profile.skills',
      message: 'LinkedIn Skills are temporarily unavailable.',
      resolution: 'Wait for the section to become readable, then rebuild Preview.' })
    return []
  }
  const currentByKey = new Map(section(current, 'skills').map(name)
    .filter((value): value is string => Boolean(value)).map(value => [skillKey(value), value]))
  const currentNames = [...currentByKey.values()]
  if (currentNames.length > 100) {
    issues.push({ level: 'fatal', path: 'profile.skills',
      message: `LinkedIn already contains ${currentNames.length} Skills.`,
      resolution: 'Reduce the profile to 100 Skills manually before Apply.' })
    return []
  }
  const currentKeys = new Set(currentByKey.keys())
  const room = Math.max(0, desired.skills.targetCount - currentNames.length)
  const requestedKeys = new Set<string>()
  const requestedMissing = desired.skills.add.filter(value => {
    const key = skillKey(value)
    if (!key || currentKeys.has(key) || requestedKeys.has(key)) return false
    requestedKeys.add(key)
    return true
  })
  const missing = requestedMissing.slice(0, room)
  if (!room && requestedMissing.length) {
    issues.push({ level: 'warning', path: 'profile.skills.add',
      message: `В профиле уже ${currentNames.length} Skills; ${requestedMissing.length} из JSON отсутствуют.`,
      resolution: 'Автоматическая замена или удаление Skills пока не поддерживается.' })
  }
  if (currentNames.length + missing.length < 100 && desired.skills.add.length) {
    issues.push({ level: 'fatal', path: 'profile.skills.add',
      message: `Only ${currentNames.length + missing.length} of 100 Skills are planned.`,
      resolution: 'Regenerate from the CV to resolve the exact missing Skills.' })
  }
  const steps: PlanStep[] = []
  for (let offset = 0; offset < missing.length; offset += 10) {
    const batch = missing.slice(offset, offset + 10)
    steps.push({
      id: `skills-${offset / 10 + 1}`, section: 'skills', action: 'add',
      summary: `Добавить Skills: ${batch.join(', ')}`,
      before: { count: currentNames.length + offset },
      after: { count: currentNames.length + offset + batch.length, added: batch },
      payload: linkedInPayload('skills', batch.map(name => ({ name }))),
      verification: { kind: 'skills', expected: batch }
    })
  }
  if (desired.skills.add.length) steps.push({
    id: 'skills-final-check', section: 'skills', action: 'add', readOnly: true,
    summary: 'Verify the complete preserved Skills set', before: { count: currentNames.length },
    after: { count: currentNames.length + missing.length }, payload: {},
    verification: { kind: 'skills', expected: [...currentNames, ...missing], exact: true }
  })
  return steps
}
