import type { ProfileInput, ValidationIssue, ValidationResult } from './input-types.ts'
import { normalizeProfileDocument } from './normalization/document.ts'
import { parseEducation } from './validation/education.ts'
import { parseExperience } from './validation/experience.ts'
import { parseOpenToWork } from './validation/open-to-work.ts'
import { isObject, strings, warning } from './validation/shared.ts'

const FIELDS = new Set(['headline', 'about', 'skills', 'experience', 'education', 'open_to_work'])

function validateDocument(input: unknown, initialIssues: ValidationIssue[] = []): ValidationResult {
  const issues = [...initialIssues]
  if (!isObject(input) || !isObject(input.profile)) return { issues }
  const source = input.profile
  Object.keys(source).filter(key => !FIELDS.has(key)).forEach(key =>
    warning(issues, `profile.${key}`, 'Field is not supported by schema V1.'))
  const skillSource = isObject(source.skills) ? source.skills : {}
  const requestedTarget = Number(skillSource.target_count ?? 100)
  const targetCount = Number.isInteger(requestedTarget) && requestedTarget >= 95 && requestedTarget <= 103
    ? requestedTarget : 100
  if (skillSource.target_count !== undefined && targetCount !== requestedTarget) {
    warning(issues, 'profile.skills.target_count', 'Allowed range is 95-103.', 'Using 100.')
  }
  const value: ProfileInput = {
    schemaVersion: 1,
    headline: typeof source.headline === 'string' ? source.headline.trim() : undefined,
    about: typeof source.about === 'string' ? source.about : undefined,
    skills: { add: strings(skillSource.add, 'profile.skills.add', issues), targetCount },
    experience: parseExperience(source.experience, issues),
    education: parseEducation(source.education, issues),
    openToWork: parseOpenToWork(source.open_to_work, issues)
  }
  const empty = !value.headline && value.about === undefined && !value.skills.add.length &&
    !value.experience.length && !value.education.length && !value.openToWork
  if (empty) warning(issues, 'profile', 'No applicable changes remain after normalization.')
  return { value, issues, normalized: input }
}

export function validateProfileFile(input: unknown): ValidationResult {
  const normalized = normalizeProfileDocument(input)
  return validateDocument(normalized.document, normalized.issues)
}

export function analyzeProfileFile(input: unknown) {
  const normalized = normalizeProfileDocument(input)
  const validation = validateDocument(normalized.document, normalized.issues)
  return { document: normalized.document, issues: validation.issues,
    valid: Boolean(validation.value) && !validation.issues.some(issue => issue.level === 'fatal') }
}
