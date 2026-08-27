import type { JsonObject, ValidationIssue } from './input-types.ts'
import type { ProfileLogger } from './profile-logger.ts'

function collect(value: unknown, path: string, paths: Set<string>) {
  if (Array.isArray(value)) {
    if (!value.length || value.every(item => typeof item !== 'object' || item === null)) {
      paths.add(path)
      return
    }
    value.forEach((item, index) => collect(item, `${path}[${index}]`, paths))
    return
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as JsonObject)
    if (!entries.length) paths.add(path)
    entries.forEach(([key, item]) => collect(item, `${path}.${key}`, paths))
    return
  }
  paths.add(path)
}

export function logValidationFields(
  logger: ProfileLogger, document: JsonObject | undefined, issues: ValidationIssue[]
) {
  const paths = new Set<string>()
  if (document?.profile) collect(document.profile, 'profile', paths)
  issues.forEach(issue => paths.add(issue.path))
  for (const fieldPath of [...paths].sort()) {
    const fieldIssues = issues.filter(issue => issue.path === fieldPath)
    const failed = fieldIssues.some(issue => issue.level === 'fatal' || !issue.autoFixed)
    logger.event('field_validation', failed ? 'failed' : 'succeeded', {
      fieldPath, issueCount: fieldIssues.length
    })
  }
}
