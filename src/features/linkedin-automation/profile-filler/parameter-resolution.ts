import type { JsonObject, ValidationIssue } from './input-types.ts'
import { createParameterSearch } from './parameter-search.ts'
import type { PlanStep, ProfileClient } from './plan-types.ts'
import type { ProfileLogger } from './profile-logger.ts'

const linkedin = (step: PlanStep) =>
  (step.payload.specifics as JsonObject)?.linkedin as JsonObject | undefined

function omitEmploymentType(step: PlanStep) {
  const value = linkedin(step)?.experience as JsonObject | undefined
  if (value) delete value.employment_type
  delete (step.after as JsonObject).employment_type
  const expected = (step.verification as unknown as JsonObject).expected as JsonObject | undefined
  if (expected) delete expected.employmentType
}

export async function resolvePlanParameters(
  client: ProfileClient, accountId: string, steps: PlanStep[], issues: ValidationIssue[],
  logger?: ProfileLogger
) {
  const resolve = createParameterSearch(client, accountId, logger)
  for (const step of steps) {
    if (step.section !== 'experience') continue
    const value = linkedin(step)?.experience as JsonObject | undefined
    const name = String(value?.employment_type ?? '').trim()
    if (!name) continue
    const result = await resolve('EMPLOYMENT_TYPE', name)
    const match = result.exact ?? (result.matches.length === 1 ? result.matches[0] : undefined)
    if (match) {
      value!.employment_type = match.id
      continue
    }
    omitEmploymentType(step)
    const index = Math.max(0, Number(step.id.split('-')[1]) - 1)
    issues.push({ level: 'warning', path: `profile.experience[${index}].data.employment_type`,
      message: `LinkedIn employment type "${name}" was not resolved.`,
      resolution: 'The optional field was removed; the rest of Experience can be applied.' })
  }
  return steps
}
