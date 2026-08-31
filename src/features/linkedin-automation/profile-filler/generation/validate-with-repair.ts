import { logAction } from '../log-action.ts'
import { validateGeneratedProfile } from './validate-generated.ts'
import { applyMetricFallback } from './metric-fallback.ts'

type ValidationResult = ReturnType<typeof validateGeneratedProfile>

export async function validateWithRepair(options: {
  generated: unknown
  facts: any
  country: string
  generator: any
  logger: any
}): Promise<ValidationResult> {
  const validate = (value: unknown, stage: string) => logAction(options.logger, stage, () =>
    validateGeneratedProfile(value, options.facts, options.country))
  let current = options.generated
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let validated: ValidationResult | undefined; let repairIssues: any[] = []
    try {
      validated = await validate(current, attempt ? 'generated_profile_revalidation' :
        'generated_profile_validation')
      repairIssues = validated.issues.filter((issue: any) => issue.level === 'fatal')
    } catch (error: any) {
      if (error?.code !== 'profile_generation_validation_failed') throw error
      repairIssues = Array.isArray(error.details) ? error.details : []
    }
    if (!repairIssues.length && validated) return validated
    if (attempt < 2 && options.generator.repairProfile) {
      current = await logAction(options.logger, 'generated_profile_repair', () =>
        options.generator.repairProfile(current, options.facts, options.country, repairIssues),
      { attempt: attempt + 1, issueCount: repairIssues.length })
      continue
    }
    const fallback = applyMetricFallback(current, options.facts)
    return validate(fallback, 'generated_profile_fallback_validation')
  }
  throw new Error('Generated profile validation returned no result.')
}
