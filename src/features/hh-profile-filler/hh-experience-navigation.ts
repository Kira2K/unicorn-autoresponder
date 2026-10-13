import type { Page } from 'playwright'
import { profileFillerError } from './errors.ts'
import { skillKey } from './skill-selection.ts'

// Only the known, non-publishing skill-level step may be completed here.
// The experience screen itself is never submitted by this adapter.
export async function openExperienceSelection(page: Page, resumeId: string, skills: string[],
  completeLevels: () => Promise<void>, same = (a: string, b: string) => skillKey(a) === skillKey(b)): Promise<void> {
  const url = `https://hh.ru/profile/resume/experience?resume=${encodeURIComponent(resumeId)}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForFunction(() => location.pathname === '/profile/resume/professional_role' ||
    Boolean(document.querySelector('[data-qa*="resume-profile-screen_experience"], ' +
      '[data-qa*="resume-profile-screen_skill_levels"]')), undefined, { timeout: 15_000 }).catch(() => undefined)
  const experience = page.locator('[data-qa*="resume-profile-screen_experience"]:visible')
  const levels = page.locator('[data-qa*="resume-profile-screen_skill_levels"]:visible')
  await experience.or(levels).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
  if (await levels.isVisible()) {
    await page.waitForFunction(() => document.querySelectorAll(
      '[data-qa*="resume-profile-screen_skill_levels"] [data-qa="skillName"]').length === 30,
      undefined, { timeout: 10_000 }).catch(() => undefined)
    const names = await levels.locator('[data-qa="skillName"]').allInnerTexts()
    const missing = skills.filter(skill => !names.some(name => same(skill, name)))
    if (names.length !== 30 || skills.length !== 30 ||
        missing.length) throw profileFillerError(
      'profile_hh_thirty_levels_unavailable',
      `Pending skill step: saved=${names.length}, expected=${skills.length}, missing=${missing.join(', ')}.`, 'fill_skills')
    await completeLevels()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  }
  await experience.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
  if (!(await experience.isVisible())) throw profileFillerError('profile_hh_experience_screen_missing',
    `Cannot open experience selection; actual screen is ${new URL(page.url()).pathname}.`, 'fill_resume')
}
