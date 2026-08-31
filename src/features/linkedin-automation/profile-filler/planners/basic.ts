import type { JsonObject, ProfileInput, ValidationIssue } from '../input-types.ts'
import type { PlanStep } from '../plan-types.ts'
import { linkedInPayload } from '../payloads.ts'

function unread(issues: ValidationIssue[], path: string, label: string) {
  issues.push({ level: 'warning', path, message: `Current ${label} was not returned.`,
    resolution: 'The new value will be written and verified after the write.' })
}

export function planBasic(
  desired: ProfileInput, current: JsonObject, issues: ValidationIssue[]
): PlanStep[] {
  const steps: PlanStep[] = []
  const headlineRead = Object.hasOwn(current, 'description')
  if (desired.headline !== undefined && !headlineRead) unread(issues, 'profile.headline', 'Headline')
  if (desired.headline !== undefined &&
    (!headlineRead || desired.headline !== String(current.description ?? ''))) {
    steps.push({
      id: 'headline', section: 'headline', action: 'update', summary: 'Изменить Headline',
      before: headlineRead ? current.description ?? null : null, after: desired.headline,
      payload: linkedInPayload('headline', desired.headline),
      verification: { kind: 'headline', expected: desired.headline }
    })
  }
  const aboutRead = Object.hasOwn(current, 'bio')
  if (desired.about !== undefined && !aboutRead) unread(issues, 'profile.about', 'About')
  if (desired.about !== undefined && (!aboutRead || desired.about !== String(current.bio ?? ''))) {
    steps.push({
      id: 'about', section: 'about', action: 'update', summary: 'Изменить About',
      before: aboutRead ? current.bio ?? null : null, after: desired.about,
      payload: { bio: desired.about }, verification: { kind: 'about', expected: desired.about }
    })
  }
  return steps
}
