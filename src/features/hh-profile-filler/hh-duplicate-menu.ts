import type { Page, Locator } from 'playwright'
import { profileFillerError } from './errors.ts'

// Open only the selected resume's actions; never duplicate or publish here.
export async function openResumeActions(page: Page, resumeId: string): Promise<void> {
  if (!/^[a-z0-9]+$/i.test(resumeId)) throw new Error('Invalid HH resume ID')
  async function findMenu(): Promise<Locator | undefined> {
    const link = page.locator(`a[href*="${resumeId}"], [data-qa="resume-card-link-${resumeId}"]`).first()
    if (!(await link.isVisible().catch(() => false))) return undefined
    const compactCard = link.locator('xpath=ancestor::*[@data-qa="resume"][1]')
    const card = await compactCard.count() ? compactCard : link.locator(
      'xpath=ancestor::*[.//*[@data-qa="resume-list-action-more"]][1]')
    const menu = card.locator('[data-qa="resume-list-action-more"]').first()
    return await menu.isVisible().catch(() => false) ? menu : undefined
  }
  let menu = await findMenu()
  if (!menu) {
    const allResumes = page.locator('[data-qa="compact-resume-show-more"]:visible')
    if (await allResumes.count() === 1) {
      await allResumes.click()
      await page.waitForURL(url => url.pathname === '/applicant/my_resumes', { timeout: 15000 })
      await page.locator(`a[href*="${resumeId}"]`).first().waitFor({state: 'visible', timeout: 15000})
      menu = await findMenu()
    }
  }
  if (!menu) throw profileFillerError('profile_hh_duplicate_unavailable',
    `Duplicate menu was not found for baseline resume ${resumeId}.`, 'duplicate_resume')
  await menu.click()
}
