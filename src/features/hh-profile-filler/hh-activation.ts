import fs from 'node:fs'
import path from 'node:path'
import type { Page } from 'playwright'
import type { ResumeSnapshot } from './hh-resume-ui.ts'
import { completeKnownResumeProfession } from './hh-resume-ui.ts'
import { profileFillerError } from './errors.ts'

type PublicationAttributes = { status?: string; isSearchable?: boolean; hasErrors?: boolean }
export type PublicationSnapshot = ResumeSnapshot & {
  isActive: boolean; publicationStatus: string; searchable: boolean; resumeLanguage?: string
}

export function publicationIsActive(state: PublicationAttributes): boolean {
  // Editing skills on an already published resume produces `modified` while
  // HH keeps it searchable; publication must not be repeated for that state.
  return ['new', 'approved', 'corrected', 'modified'].includes(state.status ?? '') &&
    state.isSearchable === true && state.hasErrors !== true
}

export async function readResumePublication(page: Page, resume: ResumeSnapshot): Promise<PublicationSnapshot> {
  if (!/^[a-z0-9]+$/i.test(resume.id)) throw profileFillerError(
    'profile_hh_invalid_resume_id', 'Publication verification requires a known resume ID.', 'verify_active')
  let state: (PublicationAttributes & { id?: string; title?: string; lang?: string }) | undefined
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      state = await page.evaluate(async id => {
        const build = (window as Window & { globalVars?: { build?: string } }).globalVars?.build ?? ''
        const response = await fetch(`/resume/edit/${id}/position`, {
          headers: { Accept: 'application/json', 'X-Static-Version': build },
          signal: AbortSignal.timeout(30_000)
        })
        if (!response.ok) throw new Error(`HH publication read failed (HTTP ${response.status}).`)
        const data = await response.json()
        const attributes = data.applicantResume?._attributes
        return { id: attributes?.hash, title: data.resumeEditor?.fields?.title, lang: attributes?.lang,
          status: attributes?.status, isSearchable: attributes?.isSearchable, hasErrors: attributes?.hasErrors }
      }, resume.id)
      break
    } catch (error) {
      // Editor transitions can replace the JS context or briefly return HTTP 406
      // for this GET. Only re-read; never replay the preceding publishing click.
      if (attempt === 2 || !/execution context was destroyed|cannot find context|navigation|HTTP 406/i
        .test(String((error as Error)?.message))) throw error
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
      await page.waitForTimeout(500)
    }
  }
  if (!state || state.id !== resume.id || typeof state.title !== 'string' ||
      state.title.trim() !== resume.title.trim()) throw profileFillerError(
    'profile_hh_publication_identity_mismatch', 'HH publication response does not match the exact resume ID/title.',
    'verify_active')
  return { ...resume, title: state.title.trim(), isDraft: state.status === 'not_finished',
    isActive: publicationIsActive(state), searchable: state.isSearchable === true,
    publicationStatus: state.status ?? 'unknown', statusText: state.status ?? 'unknown', resumeLanguage: state.lang }
}

export async function verifyActiveResume(page: Page, resume: ResumeSnapshot): Promise<PublicationSnapshot> {
  const state = await readResumePublication(page, resume)
  if (!state.isActive) throw profileFillerError('profile_hh_resume_not_active',
    `HH resume ${resume.id} is not active: status=${state.publicationStatus}, searchable=${state.searchable}.`,
    'verify_active', { resumeId: resume.id, status: state.publicationStatus, searchable: state.searchable })
  return state
}

// Activation is the final production step, after content and privacy verification.
// Existing active resumes require no click; dry-run and live-smoke never call this.
export async function activateResume(page: Page, resume: ResumeSnapshot,
  artifactDir?: string,
  ui = { completeProfession: completeKnownResumeProfession }): Promise<PublicationSnapshot> {
  const record = (state: PublicationSnapshot) => {
    if (artifactDir) fs.writeFileSync(path.join(artifactDir, `publication-${resume.id}.json`),
      `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    return state
  }
  let state = await readResumePublication(page, resume)
  if (state.isActive) return record(state)
  if (!state.isDraft) throw profileFillerError('profile_hh_activation_unavailable',
    `HH resume needs status-specific recovery: ${state.publicationStatus}.`, 'activate_resume')
  await page.goto(`https://hh.ru/profile/resume?resume=${encodeURIComponent(resume.id)}`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  const attempts = new Map<string, number>()
  for (let step = 0; step < 12; step += 1) {
    state = await readResumePublication(page, resume)
    if (state.isActive) return record(state)
    if (!state.isDraft) break
    const currentUrl = new URL(page.url())
    if (currentUrl.pathname === '/profile/resume/professional_role' &&
        currentUrl.searchParams.get('resume') === resume.id) {
      await ui.completeProfession(page, resume)
      state = await readResumePublication(page, resume)
      record(state)
      if (state.isActive) return state
      await page.goto(`https://hh.ru/profile/resume?resume=${encodeURIComponent(resume.id)}`, {
        waitUntil: 'domcontentloaded', timeout: 120_000
      })
      continue
    }
    const next = page.locator('[data-qa="resume-profile-next-screen"]:visible').first()
    await next.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
    const url = new URL(page.url())
    if (url.searchParams.get('resume') !== resume.id ||
        !/^\/profile\/resume\/(professional_role|common|educations|skills|keyskills|skill_levels|experience)$/.test(url.pathname)) {
      throw profileFillerError('profile_hh_activation_screen_unknown',
        'HH activation left the expected resume wizard; no further publishing click was made.', 'activate_resume')
    }
    // HH leaves empty error containers mounted on valid prefilled forms.
    const errorTexts = await page.locator('[data-qa*="error"]:visible, [role="alert"]:visible')
      .allInnerTexts()
    const invalidFields = await page.locator('[aria-invalid="true"]:visible').count()
    if (invalidFields || errorTexts.some(text => text.trim())) throw profileFillerError('profile_hh_activation_validation',
      'HH requires correcting a validation error before publication.', 'activate_resume')
    const count = attempts.get(url.pathname) ?? 0
    if (count >= 2 || !(await next.isEnabled().catch(() => false))) throw profileFillerError(
      'profile_hh_activation_stalled', 'HH did not complete the filled wizard step.', 'activate_resume')
    attempts.set(url.pathname, count + 1)
    await next.click()
    await page.waitForTimeout(1500)
    // Read server state before another click, including after a publishing transition.
    state = await readResumePublication(page, resume)
    record(state)
    if (state.isActive) {
      // HH confirms server publication before its delayed SPA redirect finishes.
      // Let that transition settle before the caller opens another resume.
      await page.waitForURL(url => !url.pathname.startsWith('/profile/resume'), {
        timeout: 10_000
      }).catch(() => undefined)
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
      return record(await verifyActiveResume(page, resume))
    }
    await page.waitForTimeout(1500)
  }
  return record(await verifyActiveResume(page, resume))
}
