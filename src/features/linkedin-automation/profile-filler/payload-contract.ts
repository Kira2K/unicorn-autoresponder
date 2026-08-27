import type { JsonObject, ValidationIssue } from './input-types.ts'
import type { PlanStep } from './plan-types.ts'
import type { ProfileLogger } from './profile-logger.ts'
import { validateEducation, validateExperience, validateOpenToWork } from './payload-contract-sections.ts'
import { fatal, namedList, onlyFields, record, stringField } from './payload-contract-shared.ts'

function linkedIn(step: PlanStep, issues: ValidationIssue[]) {
  const path = `profile.${step.section}`
  if (!record(step.payload.specifics)) { fatal(issues, path, 'Missing LinkedIn specifics.'); return }
  onlyFields(step.payload, ['specifics'], path, issues)
  onlyFields(step.payload.specifics, ['linkedin'], path, issues)
  const value = step.payload.specifics.linkedin
  if (!record(value)) { fatal(issues, path, 'Missing LinkedIn payload.'); return }
  onlyFields(value, [step.section], path, issues)
  return value[step.section]
}

export function validatePlanPayloads(
  steps: PlanStep[], issues: ValidationIssue[], logger?: ProfileLogger
) {
  for (const step of steps) {
    const issueCount = issues.length
    const path = `profile.${step.section}`
    if (step.section === 'about') {
      onlyFields(step.payload, ['bio'], path, issues)
      stringField(step.payload.bio, path, issues, true)
      logger?.event('payload_validation', issues.length === issueCount ? 'succeeded' : 'failed',
        { stepId: step.id, section: step.section, issueCount: issues.length - issueCount })
      continue
    }
    const value = linkedIn(step, issues)
    if (step.section === 'headline') stringField(value, path, issues, true)
    else if (step.section === 'skills') namedList(value, path, issues)
    else if (!record(value)) fatal(issues, path, 'Expected an object accepted by Unipile v2.')
    else if (step.section === 'experience') validateExperience(value, path, issues)
    else if (step.section === 'education') validateEducation(value, path, issues)
    else validateOpenToWork(value, path, issues)
    logger?.event('payload_validation', issues.length === issueCount ? 'succeeded' : 'failed',
      { stepId: step.id, section: step.section, issueCount: issues.length - issueCount })
  }
}
