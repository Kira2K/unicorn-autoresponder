import { logAction } from '../log-action.ts'
import { validateGeneratedProfile } from './validate-generated.ts'

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
  let validated
  let repairIssues: any[] = []
  let validationError: any
  try {
    validated = await validate(options.generated, 'generated_profile_validation')
    repairIssues = validated.issues.filter((issue: any) => issue.level === 'fatal')
  } catch (error: any) {
    if (error?.code !== 'profile_generation_validation_failed') throw error
    validationError = error
    repairIssues = Array.isArray(error.details) ? error.details : []
  }
  if (!repairIssues.length || !options.generator.repairProfile) {
    if (validationError) throw validationError
    if (validated) return validated
    throw new Error('Generated profile validation returned no result.')
  }
  const repaired = await logAction(options.logger, 'generated_profile_repair', () =>
    options.generator.repairProfile(options.generated, options.facts, options.country, repairIssues))
  return validate(repaired, 'generated_profile_revalidation')
}
