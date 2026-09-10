import type { ProfileInput, ValidationIssue } from './input-types.ts'
import type { PlanStep, ProfilePlan } from './plan-types.ts'

export function issueUnit(path: string) {
  return path.match(/^profile\.(?:experience|education)\[\d+\](?=\.|$)/)?.[0] ??
    path.match(/^profile\.(?:headline|about|skills|open_to_work)(?=\.|$)/)?.[0] ??
    (/^profile\.(experience|education)$/.test(path) ? path : undefined)
}
export function stepUnit(step: PlanStep) {
  const index = step.id.match(/^(experience|education)-(\d+)$/)
  return index ? `profile.${index[1]}[${Number(index[2]) - 1}]` : `profile.${step.section}`
}
const covers = (unit: string, path: string) => path === unit ||
  path.startsWith(`${unit}.`) || path.startsWith(`${unit}[`)

export function readyChanges(steps: PlanStep[], issues: ValidationIssue[]) {
  const skipped = new Set(issues.filter(issue => issue.level === 'fatal')
    .map(issue => issueUnit(issue.path)).filter((path): path is string => Boolean(path)))
  // Entry Skills share the same total limit; an unreadable/invalid Skills section blocks them too.
  if (skipped.has('profile.skills')) for (const step of steps) {
    if ((step.verification.kind === 'experience' || step.verification.kind === 'education') &&
      step.verification.expected.skills.length) skipped.add(stepUnit(step))
  }
  return { skippedChanges: [...skipped],
    steps: steps.filter(step => ![...skipped].some(unit => covers(unit, stepUnit(step)))) }
}
export function hasBlockingIssues(plan: Pick<ProfilePlan, 'issues' | 'skippedChanges' | 'steps'>) {
  const skipped = plan.skippedChanges ?? []
  if (skipped.length && (!plan.steps.length || plan.steps.some(step =>
    skipped.some(unit => covers(unit, stepUnit(step)))))) return true
  return plan.issues.some(issue => issue.level === 'fatal' &&
    !skipped.some(unit => covers(unit, issue.path)))
}
export function executableInput(input: ProfileInput, skipped: string[] = []): ProfileInput {
  return { ...input, ...Object.fromEntries((['experience', 'education'] as const).map(section =>
    [section, input[section].filter((_entry, index) =>
      !skipped.some(unit => covers(unit, `profile.${section}[${index}]`)))])) }
}
