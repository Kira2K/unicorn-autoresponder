import type { ContractCheck, ProfileFillerResult, ResumeContractVerification } from './types.ts'

export const PROFILE_CONTRACT_VERSION = 2
export const REQUIRED_SKILLS = 30
export const CONTRACT_SECTIONS = [
  'title', 'publication', 'identity', 'contacts', 'about', 'experience', 'education',
  'languages', 'skills', 'resumeLanguage', 'location', 'permits', 'workPreferences',
  'privacy', 'employers', 'preservation'
] as const

export function check(passed: boolean, reason: string): ContractCheck {
  return passed ? { status: 'passed' } : { status: 'failed', reason }
}

export function strictSkillsCheck(tags: string[], advanced: string[]): ContractCheck {
  const key = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  const selected = new Set(tags.map(key).filter(Boolean))
  const levels = new Set(advanced.map(key).filter(Boolean))
  return check(tags.length === REQUIRED_SKILLS && selected.size === REQUIRED_SKILLS &&
    levels.size === REQUIRED_SKILLS && [...selected].every(tag => levels.has(tag)),
  'Exactly 30 distinct persisted skills must all have Advanced level.')
}

export function contractIssues(value: ResumeContractVerification): string[] {
  const issues = [...value.issues]
  if (value.contractVersion !== PROFILE_CONTRACT_VERSION) issues.push('contract_version_missing')
  for (const name of CONTRACT_SECTIONS) {
    const item = value.checks?.[name]
    const allowedException = name === 'employers' && item?.status === 'exception' && Boolean(item.reason)
    const allowedWarning = name === 'contacts' && item?.status === 'warning' && Boolean(item.reason)
    // Not applicable must be explicitly justified by the reader, never by a missing control.
    const allowedNA = ['education', 'permits'].includes(name) &&
      item?.status === 'not_applicable' && Boolean(item.reason)
    if (item?.status !== 'passed' && !allowedException && !allowedNA && !allowedWarning) issues.push(`${name}_not_verified`)
  }
  if (!value.contentFingerprint) issues.push('content_fingerprint_missing')
  if (!value.titleVerified || !value.experienceVerified) issues.push('core_not_verified')
  if (!value.privacy.blacklist || !value.privacy.hiddenPhones || !value.privacy.anonymous ||
      !value.privacy.otherFieldsVisible || !value.privacy.preservedEmployers) issues.push('privacy_not_verified')
  if (value.privacy.employers.some(item => item.status === 'skipped' &&
      !['ambiguous', 'not_found'].includes(item.reason ?? ''))) issues.push('employer_not_verified')
  return [...new Set(issues)]
}

export function verifyOperationContract(titles: string[], verifications: ResumeContractVerification[],
  finalIds: string[]): boolean {
  if (!titles.length || new Set(titles).size !== titles.length || verifications.length !== titles.length ||
      new Set(verifications.map(value => value.resumeId)).size !== titles.length ||
      new Set(finalIds).size !== finalIds.length || finalIds.length !== titles.length) return false
  return verifications.every((value, index) => !value.isDraft && value.isActive === true && value.searchable === true &&
    value.jobSearchStatus === 'active_search' && value.title === titles[index] &&
    finalIds.includes(value.resumeId) && contractIssues(value).length === 0 &&
    value.contentFingerprint === verifications[0].contentFingerprint)
}

export function assertTerminalSuccess(result: ProfileFillerResult): void {
  if (!result.ok || result.dryRun || !result.operationComplete || result.contractVersion !== PROFILE_CONTRACT_VERSION ||
      !result.operationId || !result.dolphinProfileName ||
      !verifyOperationContract(result.expectedTitles ?? [], result.contractVerification ?? [],
        result.finalResumeIds ?? [])) throw new Error('profile_result_not_terminal')
}
