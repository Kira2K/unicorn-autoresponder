import { codedError } from '../errors.ts'
import { validateProfileFile } from '../validator.ts'
import { factIssues } from './fact-check.ts'
import { guideIssues } from './guide-validation.ts'
import { strictFieldIssues } from './strict-fields.ts'
import { shapeIssues } from './shape-validation.ts'
import type { CvFacts } from './types.ts'

export function validateGeneratedProfile(document: unknown, facts: CvFacts, country: string) {
  const strict = strictFieldIssues(document)
  const validation = validateProfileFile(document)
  const issues = [...strict, ...shapeIssues(document), ...validation.issues, ...guideIssues(document, country),
    ...factIssues(document, facts)]
  if (!validation.value) {
    throw codedError('profile_generation_validation_failed',
      'Generated profile failed strict validation.', issues)
  }
  return { value: validation.value, issues }
}
