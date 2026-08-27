import type { JsonObject } from './input-types.ts'
import type { PlanStep } from './plan-types.ts'
import type { Parameter } from './parameter-search.ts'

export function expectSkills(step: PlanStep, skills: Parameter[]) {
  const names = skills.map(item => item.name)
  const verification = step.verification as unknown as JsonObject
  if (step.section === 'skills') {
    verification.expected = names
    const after = step.after as JsonObject
    after.added = names
    after.count = Number((step.before as JsonObject)?.count ?? 0) + names.length
    step.summary = `Add Skills: ${names.join(', ')}`
    return
  }
  ;(verification.expected as JsonObject).skills = names
  ;(step.after as JsonObject).skills = names
}
