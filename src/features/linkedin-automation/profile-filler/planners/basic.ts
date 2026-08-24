import type { JsonObject, ProfileInput, ValidationIssue } from '../input-types.ts'
import type { PlanStep } from '../plan-types.ts'
import { linkedInPayload } from '../payloads.ts'

export function planBasic(
  desired: ProfileInput, current: JsonObject, issues: ValidationIssue[]
): PlanStep[] {
  const steps: PlanStep[] = []
  if (desired.headline !== undefined && !Object.hasOwn(current, 'description')) {
    issues.push({ level: 'warning', path: 'profile.headline',
      message: 'Headline не прочитан.', resolution: 'Раздел пропущен.' })
  } else if (desired.headline !== undefined && desired.headline !== String(current.description ?? '')) {
    steps.push({
      id: 'headline', section: 'headline', action: 'update', summary: 'Изменить Headline',
      before: current.description ?? null, after: desired.headline,
      payload: linkedInPayload('headline', desired.headline),
      verification: { kind: 'headline', expected: desired.headline }
    })
  }
  if (desired.about !== undefined && !Object.hasOwn(current, 'bio')) {
    issues.push({ level: 'warning', path: 'profile.about',
      message: 'About не прочитан.', resolution: 'Раздел пропущен.' })
  } else if (desired.about !== undefined && desired.about !== String(current.bio ?? '')) {
    steps.push({
      id: 'about', section: 'about', action: 'update', summary: 'Изменить About',
      before: current.bio ?? null, after: desired.about, payload: { bio: desired.about },
      verification: { kind: 'about', expected: desired.about }
    })
  }
  return steps
}
