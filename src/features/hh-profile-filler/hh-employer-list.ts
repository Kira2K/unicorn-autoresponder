import type { Locator, Page } from 'playwright'
import { contentText } from './content-policy.ts'
import { preserveFirstObservation } from './preservation-state.ts'

export function employerDialog(page: Page): Locator {
  return page.locator('[data-qa="resume-editor-employer-list-search-input"]').locator(
    'xpath=ancestor::*[@role="dialog" or .//*[@data-qa="resume-modal-button-save"]][1]')
}

export async function readEmployerList(page: Page): Promise<string[]> {
  const dialog = employerDialog(page)
  if (!(await dialog.isVisible())) throw new Error('employer_list_unreadable')
  const saved = dialog.locator('[data-qa^="resume-editor-employer-list-item-"]')
  if (await saved.count()) return (await saved.allInnerTexts()).map(contentText)
  const checks = dialog.locator('label[data-qa="cell"]:has(input[type="checkbox"])')
  if (await checks.count()) return (await checks.filter({ has: page.locator('input:checked') })
    .allInnerTexts()).map(contentText)
  // An observed, hydrated saved-list container can be empty. No global fallback.
  if (await dialog.locator('[data-qa="modal-content-scroll-container"]').count()) return []
  throw new Error('employer_list_unreadable')
}

export async function preservedEmployerNames(page: Page, operationId: string, id: string,
  current: string[]): Promise<string[]> {
  const original = preserveFirstObservation(operationId, id, 'employers', current)
  const phoneCaption = contentText(await page.locator(
    '[data-qa="resume-visibility-card-hidden-fields-phones"]').innerText())
  const excluded = original.filter(name => contentText(name) === phoneCaption &&
    !current.some(company => contentText(company) === contentText(name)))
  if (!excluded.length) return original
  const corrected = [...new Set([...original.filter(name => !excluded.includes(name)), ...current])]
  const correction = preserveFirstObservation(operationId, id, 'employers-reader-correction-v1', {
    reason: 'A legacy global checkbox reader captured the verified phone-setting caption.',
    original, excluded, corrected
  })
  return correction.corrected
}
