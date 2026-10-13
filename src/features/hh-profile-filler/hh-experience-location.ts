import type { Page } from 'playwright'
import type { CvExperience } from './types.ts'
import { contentText, experienceContentMatches } from './content-policy.ts'
import { profileFillerError } from './errors.ts'

// The observed HH work editor has no location field. Retain source-supported
// geography/remote context in the description, preserving its existing text.
export async function ensureExperienceLocations(page: Page, items: CvExperience[]): Promise<void> {
  for (const item of items.filter(item => item.location)) {
    await page.goto('https://hh.ru/profile/block/experience', { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const cards = page.locator('[data-qa="profile-experience-company-card"]')
    await cards.first().waitFor({ state: 'visible', timeout: 15_000 })
    const texts = await cards.allInnerTexts()
    const matches = texts.flatMap((text, i) => experienceContentMatches(text, { ...item, location: undefined }) ? [i] : [])
    if (matches.length !== 1) throw profileFillerError('profile_hh_experience_ambiguous',
      'Location context requires one verified existing experience record.', 'fill_resume')
    if (contentText(texts[matches[0]]).includes(contentText(item.location!))) continue
    const edit = cards.nth(matches[0]).locator('button[data-qa^="edit-experience-button-"]')
    if (await edit.count() !== 1) throw new Error('experience_location_editor_ambiguous')
    await edit.click()
    const description = page.locator('[data-qa="resume-editor-experience-description-input"]')
    await description.waitFor({ state: 'visible', timeout: 15_000 })
    const company = await page.locator('input[name="company"]').inputValue()
    const title = await page.locator('input[name="position"]').inputValue()
    if (contentText(company) !== contentText(item.company) || contentText(title) !== contentText(item.title)) {
      throw new Error('experience_location_target_mismatch')
    }
    const before = await description.inputValue()
    const wanted = contentText(before).includes(contentText(item.location!)) ? before : `${item.location}\n\n${before}`
    if (wanted !== before) {
      await description.fill(wanted)
      const save = page.locator('[data-qa="profile-layout-save-button"]:visible')
      await save.click()
      await save.waitFor({ state: 'hidden', timeout: 15_000 })
    }
    await page.goto('https://hh.ru/profile/block/experience', { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await cards.first().waitFor({ state: 'visible', timeout: 15_000 })
    if (!(await cards.allInnerTexts()).some(text => experienceContentMatches(text, item))) {
      throw new Error('experience_location_not_persisted')
    }
  }
}
