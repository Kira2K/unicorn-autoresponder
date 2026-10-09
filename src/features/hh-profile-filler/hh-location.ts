import type { Page } from 'playwright'
import { contentText } from './content-policy.ts'

export async function readResumeLocation(page: Page, resumeId: string, isDraft = true): Promise<string> {
  if (!isDraft) {
    // Published resumes leave the creation wizard. HH exposes their shared
    // residence in the applicant profile's Where you live card, not in About
    // or in the header's vacancy-search area selector.
    await page.goto('https://hh.ru/applicant/profile/me',
      { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const card = page.locator('button[data-qa="cell"]').filter({ has:
      page.locator('[data-qa="cell-text-content"]').filter({ hasText: /^Где\s+жив[её]те$/i }) })
    const label = card.locator('[data-qa="cell-text-content"]').nth(1)
    await label.waitFor({ state: 'visible', timeout: 15_000 })
    if (await card.count() !== 1) throw new Error('location_unreadable')
    const value = contentText((await label.innerText()).split('·')[0])
    if (!value || /^\d+$/.test(value) || /не указано/i.test(value)) throw new Error('location_unreadable')
    return value
  }
  await page.goto(`https://hh.ru/profile/resume/common?resume=${encodeURIComponent(resumeId)}`,
    { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const input = page.locator('[data-qa="profile-common-edit-area"]')
  await input.waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForFunction(() => {
    const control = document.querySelector<HTMLInputElement>('[data-qa="profile-common-edit-area"]')
    return Boolean(control?.value.trim() || control?.parentElement
      ?.querySelector('[class*="value-ghost"]')?.textContent?.trim())
  }, undefined, { timeout: 10_000 }).catch(() => undefined)
  // HH's combobox can clear its search input while rendering the selected city
  // in its adjacent value-ghost. Only this control is relevant, never header area.
  const selected = input.locator('xpath=..').locator('[class*="value-ghost"]')
  const label = await selected.innerText({ timeout: 1000 }).catch(() => '')
  const value = contentText(label || await input.inputValue())
  if (!value || /^\d+$/.test(value)) throw new Error('location_unreadable')
  return value
}
