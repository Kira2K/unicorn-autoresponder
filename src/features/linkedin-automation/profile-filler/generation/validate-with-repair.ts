import { logAction } from '../log-action.ts'
import { validateGeneratedProfile } from './validate-generated.ts'
import { applyMetricFallback } from './metric-fallback.ts'
import { codedError } from '../errors.ts'
import { generatedContractIssues } from './materialize-profile.ts'

type ValidationResult = ReturnType<typeof validateGeneratedProfile>

function issueCode(issue: any) {
  const message = String(issue?.message ?? '')
  if (message.includes('Every attached Skill')) return 'attached_skill_not_in_candidates'
  if (message.includes('CV fact ID')) return 'cv_fact_id_invalid'
  if (message.includes('Experience count')) return 'experience_count_mismatch'
  if (message.includes('Education count')) return 'education_count_mismatch'
  if (message.includes('metrics')) return 'unsupported_metric'
  return 'profile_generation_validation_issue'
}

function logIssues(logger: any, issues: any[], attempt: number) {
  issues.forEach(issue => logger.event('generated_profile_issue', 'failed', {
    attempt, fieldPath: issue.path, errorCode: issueCode(issue)
  }))
}

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
    logIssues(options.logger, repairIssues, attempt + 1)
    if (!repairIssues.length && validated) return validated
    if (attempt < 2 && options.generator.repairProfile) {
      current = await logAction(options.logger, 'generated_profile_repair', () =>
        options.generator.repairProfile(current, options.facts, options.country, repairIssues),
      { attempt: attempt + 1, issueCount: repairIssues.length })
      continue
    }
    const contract = generatedContractIssues(current)
    if (contract.some(issue => issue.level === 'fatal')) throw codedError(
      'profile_generation_validation_failed', 'CV fact IDs remain invalid after two repairs.', contract)
    const fallback = applyMetricFallback(current, options.facts)
    const final = await validate(fallback, 'generated_profile_fallback_validation')
    const fatal = final.issues.filter((issue: any) => issue.level === 'fatal')
    if (fatal.length) throw codedError('profile_generation_validation_failed',
      'Generated profile is incomplete after two repairs.', fatal)
    return final
  }
  throw new Error('Generated profile validation returned no result.')
}
