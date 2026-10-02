import type { Page } from 'playwright'
import type { ResumeSnapshot } from './hh-resume-ui.ts'
import { profileFillerError } from './errors.ts'

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
