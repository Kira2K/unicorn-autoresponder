import type { Page } from 'playwright'
import { profileFillerError } from './errors.ts'

export const ACTIVE_JOB_SEARCH_STATUS = 'active_search' as const
const LABEL = 'Активно ищу работу'
const TRIGGER = '[data-qa="applicant-profile-job-search-status-trigger"]'
const VALUE = '[data-qa="applicant-profile-job-search-status-value"]'
const RADIO = 'input[name="job_search_status"][value="active_search"]'
const PROFILE = 'https://hh.ru/applicant/profile/me'

async function openStatus(page: Page): Promise<void> {
  await page.goto(PROFILE, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  if (new URL(page.url()).pathname !== '/applicant/profile/me') throw profileFillerError(
    'profile_hh_job_search_status_unavailable', 'HH did not open the published applicant profile.', 'job_search_status')
  await page.locator(TRIGGER).waitFor({ state: 'visible', timeout: 15_000 })
}

export async function verifyActiveJobSearchStatus(page: Page): Promise<typeof ACTIVE_JOB_SEARCH_STATUS> {
  await openStatus(page)
  const value = (await page.locator(VALUE).innerText()).trim()
  await page.locator(TRIGGER).click()
  const selected = await page.locator(RADIO).isChecked()
  await page.keyboard.press('Escape')
  if (value !== LABEL || !selected) throw profileFillerError('profile_hh_job_search_status_incomplete',
    'HH job-search status must be saved as actively looking for work.', 'verify_job_search_status')
  return ACTIVE_JOB_SEARCH_STATUS
}

// Account-level preference: check after each publication, never alter database workflow status.
export async function ensureActiveJobSearchStatus(page: Page): Promise<typeof ACTIVE_JOB_SEARCH_STATUS> {
  await openStatus(page)
  await page.locator(TRIGGER).click()
  if (!(await page.locator(RADIO).isChecked())) {
    await page.getByRole('dialog').getByText(LABEL, { exact: true }).click()
    await page.waitForFunction(({ selector, label }) => document.querySelector(selector)?.textContent?.trim() === label,
      { selector: VALUE, label: LABEL }, { timeout: 15_000 })
  } else await page.keyboard.press('Escape')
  // Reopen the profile and the option list: optimistic UI state alone is insufficient.
  return verifyActiveJobSearchStatus(page)
}
