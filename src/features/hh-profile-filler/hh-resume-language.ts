import type { Page } from 'playwright'
import type { ResumeSnapshot } from './hh-resume-ui.ts'
import { readResumePublication } from './hh-activation.ts'
import { profileFillerError } from './errors.ts'

export async function verifyEnglishResumeLanguage(page: Page, resume: ResumeSnapshot): Promise<'EN'> {
  const state = await readResumePublication(page, resume)
  if (state.resumeLanguage !== 'EN') throw profileFillerError('profile_hh_resume_language_incomplete',
    `En resume ${resume.id} must have persisted language EN, got ${state.resumeLanguage ?? 'unknown'}.`,
    'verify_resume_language')
  return 'EN'
}

// Resume language is metadata, distinct from the site's UI and the person's spoken languages.
export async function ensureEnglishResumeLanguage(page: Page, resume: ResumeSnapshot): Promise<'EN'> {
  if ((await readResumePublication(page, resume)).resumeLanguage === 'EN') return 'EN'
  const route = `/resume/${resume.id}`
  await page.goto(`https://hh.ru${route}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  if (new URL(page.url()).pathname !== route) throw profileFillerError(
    'profile_hh_resume_language_redirected', 'HH opened a different resume page.', 'fill_resume_language')
  const selector = page.locator('[data-qa="trigger-values-wrapper"]')
    .filter({ hasText: /^(По-русски|In English)$/ })
  await selector.waitFor({ state: 'visible', timeout: 15_000 })
  if ((await selector.innerText()).trim() !== 'In English') {
    await selector.click()
    const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 })
      .catch(() => undefined)
    await page.getByText('In English', { exact: true }).click()
    await navigation
  }
  // A click or English resume text is not proof of the saved metadata.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
  return verifyEnglishResumeLanguage(page, resume)
}
