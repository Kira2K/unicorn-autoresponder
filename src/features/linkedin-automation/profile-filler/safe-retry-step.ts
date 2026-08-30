import type { JsonObject } from './input-types.ts'
import type { PlanStep } from './plan-types.ts'

const OMIT: Record<string, string[]> = {
  experience: ['skills', 'location', 'workplace_type', 'source_of_hire'],
  education: ['skills', 'grade', 'activities'],
  open_to_work: ['employment_type', 'start_date']
}

export function safeRetryStep(step: PlanStep): PlanStep | undefined {
  const omitted = OMIT[step.section]
  if (!omitted) return undefined
  const payload = structuredClone(step.payload) as JsonObject
  const body = (payload.specifics as any)?.linkedin?.[step.section]
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  let changed = false
  omitted.forEach(field => {
    if (Object.hasOwn(body, field)) { delete body[field]; changed = true }
  })
  return changed ? { ...step, payload } : undefined
}
