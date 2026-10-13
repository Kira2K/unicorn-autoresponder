import { createHash } from 'node:crypto'
import type { Page } from 'playwright'
import { check, PROFILE_CONTRACT_VERSION, contractIssues, strictSkillsCheck } from './contract.ts'
import { contentText, experienceContentMatches, educationContentMatches, educationContentDifferences } from './content-policy.ts'
import { inspectResumeLanguage } from './hh-resume-language.ts'
import { preserveFirstObservation } from './preservation-state.ts'
import { readBirthDate, normalizedBirthDate } from './hh-birth-date.ts'
import { readResumeLocation } from './hh-location.ts'
import type { PreparedProfile, ResumeContractVerification, ResumePrivacyVerification, ContractCheck } from './types.ts'
import type { ResumeSnapshot } from './hh-resume-ui.ts'
import type { SavedSkills } from './skill-contract.ts'

export type ContractReaders = {
  publication?(): Promise<boolean>
  resumeLanguage?(): Promise<'en' | 'ru' | 'unknown'>
  privacy(): Promise<ResumePrivacyVerification>
  workPreferences(): Promise<void>
  permits(): Promise<void>
  languages(): Promise<boolean>
  experienceMembership(): Promise<boolean>
  experienceContent?(): Promise<string[]>
  educationMembership(): Promise<boolean>
  skills(): Promise<SavedSkills>
}
type Preservation = { skills: string[]; silent: Record<string, string>; extraExperience: string[]; extraEducation: string[] }
const preservation = new WeakMap<Page, Map<string, Preservation>>()
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export async function readResumeContract(page: Page, profile: PreparedProfile, resume: ResumeSnapshot,
  expectedTitle: string, readers: ContractReaders): Promise<ResumeContractVerification> {
  const checks: Record<string, ContractCheck> = {}
  const actual: Record<string, unknown> = {}
  const silent: Record<string, string> = {}
  let extraExperience: string[] = [], extraEducation: string[] = []
  const go = async (route: string) => {
    await page.goto(`https://hh.ru${route}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  }
  const inspect = async (name: string, action: () => Promise<boolean>) => {
    try { checks[name] = check(await action(), `${name}_mismatch`) }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error &&
        typeof error.code === 'string' && /^profile_[a-z_]+$/.test(error.code) ? error.code : ''
      const detail = error instanceof Error && /^draft_experience_content_mismatch:/.test(error.message)
        ? ` (${error.message})` : code ? ` (${code})` : ''
      checks[name] = check(false, `${name}_unreadable${detail}`)
    }
    // A contact comparison/read failure is advisory; retain its reason without stopping the workflow.
    if (name === 'contacts' && checks[name].status === 'failed') checks[name].status = 'warning'
  }
  const value = async (selectors: string[]) => {
    for (const selector of selectors) {
      const locator = page.locator(selector).first()
      if (await locator.isVisible().catch(() => false)) return contentText(await locator.inputValue())
    }
    throw new Error('required_field_unreadable')
  }
  const rows = async (selectors: string[]) => {
    for (const selector of selectors) {
      const locator = page.locator(selector)
      if (await locator.count()) return (await locator.allInnerTexts()).map(contentText)
    }
    return [] as string[]
  }
  let title = ''
  await inspect('title', async () => {
    await go(`/resume/edit/${resume.id}/position`)
    title = await value(['[data-qa="resume-edit-title-suggest"]', 'input[name="title"]'])
    return title === expectedTitle
  })
  await inspect('workPreferences', async () => { await readers.workPreferences(); return true })
  await inspect('contacts', async () => {
    await go(`/resume/edit/${resume.id}/contacts`)
    // HH mounts the email/radio controls before hydrating the formatted phone.
    // Retry reads only; a genuine saved mismatch still fails after the bound.
    await page.waitForFunction(expected => {
      const email = document.querySelector<HTMLInputElement>('[data-qa="resume-editor-email-input"], input[type="email"], input[name="email"]')
      const phone = document.querySelector<HTMLInputElement>('[data-qa="resume-phone-cell_phone"], input[name="phone.formatted"]')
      const preferred = document.querySelector<HTMLInputElement>('[data-qa="resume-editor-preferred-contact-email-checked"]')
      return email?.value.trim() === expected.email && (!expected.phone ||
        phone?.value.replace(/\D/g, '') === expected.phone) && preferred?.checked === true
    }, { email: profile.cv.contacts.email, phone: profile.cv.contacts.phone?.replace(/\D/g, '') },
    { timeout: 5_000 }).catch(() => undefined)
    const email = await value(['[data-qa="resume-editor-email-input"]', 'input[type="email"]', 'input[name="email"]'])
    const phone = await value(['[data-qa="resume-phone-cell_phone"]', 'input[name="phone.formatted"]'])
    const phoneDigits = phone.replace(/\D/g, '')
    if (profile.cv.contacts.phone && phoneDigits !== profile.cv.contacts.phone.replace(/\D/g, '')) return false
    if (!profile.cv.contacts.phone) silent.phone = digest(phoneDigits)
    return email === profile.cv.contacts.email && await page.locator(
      '[data-qa="resume-editor-preferred-contact-email-checked"]').isChecked()
  })
  await inspect('about', async () => {
    await go(`/resume/edit/${resume.id}/about`)
    actual.about = await value(['[data-qa="resume-editor-about"]', 'textarea[name="about"]'])
    return actual.about === contentText(profile.about)
  })
  await inspect('identity', async () => {
    await go('/profile/edit/common')
    const fields = [
      ['firstName', profile.cv.firstName, '[data-qa="resume-profile-common-name-input"], input[name="firstName"]'],
      ['lastName', profile.cv.lastName, '[data-qa="resume-profile-common-surname-input"], input[name="lastName"]'],
      ['middleName', profile.cv.middleName, '[data-qa="resume-profile-common-patronymic-input"], input[name="middleName"]']
    ] as const
    let correct = true
    for (const [name, expected, selector] of fields) {
      const observed = await value([selector])
      actual[name] = observed
      if (expected) correct &&= observed === contentText(expected)
      else silent[name] = digest(observed)
    }
    const date = await readBirthDate(page)
    actual.birthDate = date ?? ''
    if (profile.cv.birthDate) correct &&= Boolean(date) && date === normalizedBirthDate(profile.cv.birthDate)
    else silent.birthDate = digest(date ?? '')
    return correct
  })
  await inspect('location', async () => {
    const area = await readResumeLocation(page, resume.id, resume.isDraft && !resume.nativeSourceId)
    actual.location = area
    if (profile.client.market === 'En') {
      const matches = /^(?:Тбилиси|Tbilisi)(?:,\s*(?:Грузия|Georgia))?$/.test(area)
      if (matches) actual.location = 'Tbilisi, Georgia'
      return matches
    }
    if (!profile.cv.location) { silent.location = digest(area); return true }
    return area === profile.cv.location || area === profile.cv.location.split(',')[0].trim()
  })
  if (profile.client.market === 'En') await inspect('permits', async () => {
    await go('/profile/edit/common'); await readers.permits(); return true
  })
  else checks.permits = { status: 'not_applicable', reason: 'Four-country permits apply only to En.' }
  await inspect('languages', async () => {
    await go('/profile/block/languages')
    const correct = await readers.languages()
    actual.languages = await rows(['[data-qa="profile-languages"]', '[data-qa="languages-card"]'])
    // The reader checks exact language/level pairs even when the new HH cards lack data-qa.
    return correct
  })
  await inspect('experience', async () => {
    if (!(await readers.experienceMembership())) return false
    let cards: string[]
    if (readers.experienceContent) cards = (await readers.experienceContent()).map(contentText)
    else {
      await go(`/resume/${resume.id}/experience`)
      cards = await rows(['[data-qa="resume-block-experience-item"]', '[data-qa^="resume-list-card-experience-item-"]',
        '[data-qa="resume-block-experience"]'])
    }
    // Fingerprint verified fields, independent of draft/profile vs published
    // decoration, duration wording and control captions. Extra records remain
    // subject to their separate preservation check.
    actual.experience = profile.cv.experience
    extraExperience = cards.filter(card => !profile.cv.experience.some(item =>
      card.toLowerCase().includes(contentText(item.company).toLowerCase()))).map(digest)
    return profile.cv.experience.every(item => cards.filter(card => experienceContentMatches(card, item)).length === 1)
  })
  let educationDifferences: string[] = []
  await inspect('education', async () => {
    if (!(await readers.educationMembership())) return false
    await go(`/resume/${resume.id}`)
    const cards = await rows(['[data-qa="resume-block-education-item"]', '[data-qa^="resume-list-card-education-item-"]',
      '[data-qa="resume-block-education"]'])
    actual.education = cards.slice().sort()
    extraEducation = cards.filter(card => !profile.cv.education.some(item =>
      card.toLowerCase().includes(contentText(item.institution).toLowerCase()))).map(digest)
    educationDifferences = profile.cv.education.flatMap((item, index) => {
      const matching = cards.filter(card => educationContentMatches(card, item))
      if (matching.length === 1) return []
      if (matching.length > 1) return [`record_${index + 1}:duplicate`]
      const differences = cards.map(card => educationContentDifferences(card, item)).sort((a, b) => a.length - b.length)[0]
      return [`record_${index + 1}:${differences?.join(',') ?? 'missing'}`]
    })
    return educationDifferences.length === 0
  })
  if (educationDifferences.length) checks.education.reason = `education_mismatch (${educationDifferences.join('; ')})`
  let skills: SavedSkills = { tags: [], advanced: [] }
  await inspect('skills', async () => {
    skills = await readers.skills()
    actual.skills = skills.tags.map(contentText).sort()
    actual.advanced = skills.advanced.map(contentText).sort()
    return strictSkillsCheck(skills.tags, skills.advanced).status === 'passed'
  })
  await inspect('resumeLanguage', async () => {
    await go(`/resume/${resume.id}`)
    const language = readers.resumeLanguage ? await readers.resumeLanguage() : await inspectResumeLanguage(page)
    actual.resumeLanguage = language
    return language === (profile.client.market === 'En' ? 'en' : 'ru')
  })
  await inspect('publication', async () => {
    if (readers.publication) return readers.publication()
    await go('/applicant/profile/me')
    const link = page.locator(`a[data-qa="resume-card-link-${resume.id}"], a[href*="/resume/${resume.id}"]`).first()
    const card = link.locator('xpath=ancestor::*[@data-qa="resume"][1]')
    if (await card.count()) {
      const text = await card.innerText()
      const draft = /черновик|не заверш|не закончен|draft|incomplete/i.test(text)
      const published = /опубликован|published|видно работодател/i.test(text)
      return resume.isDraft ? draft && !published : published && !draft
    }
    if (!resume.isDraft) return false
    await go(`/profile/resume/experience?resume=${encodeURIComponent(resume.id)}`)
    return new URL(page.url()).searchParams.get('resume') === resume.id &&
      await page.locator('[data-qa*="resume-profile-screen_experience"]:visible').isVisible()
  })
  let privacy: ResumePrivacyVerification = { resumeId: resume.id, blacklist: false, hiddenPhones: false, employers: [] }
  await inspect('privacy', async () => {
    privacy = await readers.privacy()
    return Boolean(privacy.blacklist && privacy.hiddenPhones && privacy.anonymous && privacy.otherFieldsVisible && privacy.preservedEmployers)
  })
  const outcomes = privacy.employers
  const accounted = outcomes.length === profile.employerCandidates.length && profile.employerCandidates.every(candidate =>
    outcomes.filter(outcome => outcome.candidate === candidate.name).length === 1)
  const permitted = accounted && outcomes.every(item => item.status !== 'skipped' || ['not_found', 'ambiguous'].includes(item.reason ?? ''))
  checks.employers = check(permitted, 'Every employer candidate needs a persisted selection or permitted exception.')
  if (permitted && outcomes.some(item => item.status === 'skipped')) checks.employers = {
    status: 'exception', reason: 'Missing or ambiguous official employer cards; each outcome recorded separately.'
  }
  actual.employers = outcomes.filter(item => item.status !== 'skipped').map(item => item.officialName).sort()
  const map = preservation.get(page) ?? new Map<string, Preservation>()
  preservation.set(page, map)
  const current: Preservation = { skills: skills.tags.map(tag => digest(contentText(tag).toLowerCase())),
    silent, extraExperience, extraEducation }
  const before = profile.operationId ? preserveFirstObservation(profile.operationId, resume.id, 'content', current) :
    map.get(resume.id) ?? current
  if (before.silent.phone && before.silent.phone !== silent.phone && checks.contacts.status === 'passed') {
    checks.contacts = { status: 'warning', reason: 'contacts_preservation_unverified' }
  }
  checks.preservation = check(before.skills.every(tag => current.skills.includes(tag)) &&
    Object.entries(before.silent).every(([key, hash]) => key === 'phone' || silent[key] === hash) &&
    before.extraExperience.every(hash => extraExperience.includes(hash)) &&
    before.extraEducation.every(hash => extraEducation.includes(hash)), 'Previously saved data was lost.')
  if (!map.has(resume.id)) map.set(resume.id, before)
  const verification: ResumeContractVerification = {
    contractVersion: PROFILE_CONTRACT_VERSION, resumeId: resume.id, title, isDraft: resume.isDraft,
    titleVerified: checks.title.status === 'passed', experienceVerified: checks.experience.status === 'passed',
    // Contacts are checked separately: unstable reads must not reappear as copy fingerprint failures.
    privacy, checks, contentFingerprint: digest(actual), complete: false, issues: []
  }
  verification.issues = contractIssues(verification)
  verification.complete = verification.issues.length === 0
  return verification
}
