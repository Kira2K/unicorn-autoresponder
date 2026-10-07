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

// Language belongs to the resume. Neither document.lang nor the HH footer proves it.
export async function inspectResumeLanguage(page: Page): Promise<'en' | 'ru' | 'unknown'> {
  const root = page.locator('[data-qa="resume"]').first()
  if (!(await root.count())) return 'unknown'
  const explicit = await root.getAttribute('lang')
  if (explicit === 'en' || explicit === 'ru') return explicit
  const russianAction = root.getByRole('button', { name: /^(?:На русском|In Russian)$/i })
    .or(root.getByRole('link', { name: /^(?:На русском|In Russian)$/i }))
  const englishAction = root.getByRole('button', { name: 'In English', exact: true })
    .or(root.getByRole('link', { name: 'In English', exact: true }))
  const ru = await russianAction.count(), en = await englishAction.count()
  // An inverse action alone may mean "create another language version". Require a selected
  // language indicator; do not infer success just because In English disappeared.
  if (ru && !en && await root.getByText(/^(?:Язык резюме: английский|Resume language: English)$/i).count()) return 'en'
  if (en && !ru) return 'ru'
  return 'unknown'
}

export async function ensureResumeEnglish(page: Page, resume: ResumeSnapshot): Promise<ResumeSnapshot> {
  await page.goto(`https://hh.ru/resume/${encodeURIComponent(resume.id)}`, { waitUntil: 'domcontentloaded' })
  if (await inspectResumeLanguage(page) === 'en') return resume
  const root = page.locator('[data-qa="resume"]').first()
  const action = root.getByRole('button', { name: 'In English', exact: true })
    .or(root.getByRole('link', { name: 'In English', exact: true }))
  if (await action.count() !== 1 || !(await action.isVisible())) throw profileFillerError(
    'profile_hh_english_action_unavailable', 'The resume In English action is not unambiguously available.', 'resume_language')
  await action.click()
  await page.waitForLoadState('domcontentloaded')
  if (await page.getByRole('button', { name: /^(?:Опубликовать|Publish)$/i }).isVisible().catch(() => false)) {
    throw profileFillerError('profile_hh_english_requires_publication',
      'English conversion requires a publishing step; no publishing action was taken.', 'resume_language')
  }
  const parsed = new URL(page.url())
  const id = parsed.pathname.match(/^\/resume\/([a-z0-9]+)\/?$/i)?.[1] ?? parsed.searchParams.get('resume')
  if (!id) throw profileFillerError('profile_hh_english_not_verified',
    'English conversion did not expose a verifiable resume ID.', 'resume_language')
  await page.goto(`https://hh.ru/resume/${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded' })
  if (await inspectResumeLanguage(page) !== 'en') throw profileFillerError('profile_hh_english_not_verified',
    'English resume language did not persist after reopening.', 'resume_language')
  // Inventory/publication validation remains mandatory in the shared verifier.
  return { ...resume, id, href: page.url() }
}
