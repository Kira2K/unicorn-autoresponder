import type { Locator, Page } from 'playwright'
import type { CvLanguage } from './types.ts'
import { profileFillerError } from './errors.ts'

const LANGUAGE_EDITOR = 'https://hh.ru/profile/block/languages'
const CARDS = '[data-qa^="profile-language-bottom-sheet-content-"], [data-qa^="profile-language-card-row-"]'
const NATIVE = /родной|native/i

function languageName(value: string): string {
  const aliases: Record<string, string> = { english: 'Английский', russian: 'Русский' }
  return aliases[value.trim().toLowerCase()] ?? value.trim()
}

function levelPattern(value: string): RegExp {
  if (NATIVE.test(value)) return NATIVE
  const cefr = value.match(/\b[ABC][12]\b/i)?.[0]
  if (cefr) return new RegExp(`\\b${cefr}\\b`, 'i')
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
}

function fail(code: string, message: string): never {
  throw profileFillerError(`profile_hh_language_${code}`, message, 'fill_languages')
}

async function openEditor(page: Page) {
  await page.goto(LANGUAGE_EDITOR, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  if (new URL(page.url()).pathname !== '/profile/block/languages') {
    fail('editor_unavailable', 'HH redirected the dedicated language editor; resume publication is not a recovery step.')
  }
  await page.locator('[data-qa="profile-language-add"]').waitFor({ state: 'visible', timeout: 10_000 })
}

async function selectOption(page: Page, control: Locator, pattern: RegExp) {
  await control.click()
  const options = page.locator('[role="option"]:visible').filter({ hasText: pattern })
  await options.first().waitFor({ state: 'visible', timeout: 10_000 })
  if (await options.count() !== 1) fail('option_ambiguous', 'HH language editor option is ambiguous.')
  await options.click()
}

/** Update only source-supported languages in the dedicated editor, then reload to verify persistence. */
export async function fillProfileLanguages(page: Page, languages: CvLanguage[]): Promise<void> {
  if (!languages.length) return
  await openEditor(page)
  for (const item of languages) {
    const name = languageName(item.name)
    const namePattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const level = levelPattern(item.level)
    const cards = page.locator(CARDS).filter({ visible: true })
    const existing = cards.filter({ hasText: namePattern })
    if (await existing.count() > 1) fail('ambiguous', `HH has multiple language records for ${name}.`)
    if (await existing.count() === 1 && level.test(await existing.innerText())) continue

    // HH has one native-language slot. Correct that slot from an explicit CV
    // native language instead of adding a duplicate with an invented CEFR level.
    const native = cards.filter({ hasText: NATIVE })
    const target = await existing.count() ? existing : NATIVE.test(item.level) ? native : undefined
    if (target && await target.count() > 1) fail('ambiguous', 'HH has multiple native language records.')
    const trigger = target && await target.count()
      ? target.getByRole('button').first() : page.locator('[data-qa="profile-language-add"]')
    await trigger.click()
    const save = page.locator('[data-qa="profile-modal-button-save"]:visible')
    await save.waitFor({ state: 'visible', timeout: 3000 }).catch(async () => {
      // A click during hydration can be ignored. Retry once without navigating.
      await trigger.click()
      await save.waitFor({ state: 'visible', timeout: 10_000 })
    })
    const nameControl = page.locator('[data-qa="magritte-select-activator"][aria-label="Язык"]:visible')
    if (!(await existing.count()) || !target || !(await target.count()) ||
        !(namePattern.test(await target.innerText()))) {
      await selectOption(page, nameControl, new RegExp(`^${name}$`, 'i'))
    }
    if (!NATIVE.test(item.level)) {
      await selectOption(page,
        page.locator('[data-qa="magritte-select-activator"][aria-label="Уровень владения"]:visible'), level)
    }
    await save.click()
    await save.waitFor({ state: 'hidden', timeout: 10_000 })
    await openEditor(page)
    const saved = page.locator(CARDS).filter({ visible: true }).filter({ hasText: namePattern })
    if (await saved.count() !== 1 || !level.test(await saved.innerText())) {
      fail('not_persisted', `HH did not persist the source language and level: ${item.name} ${item.level}.`)
    }
  }
}
