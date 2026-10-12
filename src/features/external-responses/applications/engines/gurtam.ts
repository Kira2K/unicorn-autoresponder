import { readFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import type { Answers, Candidate, Field, FormInspection } from '../../types.ts'
import { inspectForm } from '../form-fields.ts'

const formSelector = '#recruitment-applications-form'
const selectIds = ['country', 'channel', 'brand_awareness', 'source'] as const

async function clickGurtamControl(control: ReturnType<Page['locator']>, label: string): Promise<void> {
  try { await control.click({ timeout: 3_000 }) }
  catch {
    // The employer's custom dropdown may be covered by a fixed page layer.
    // Its own click handler still commits the selected value, verified below.
    if (await control.count() !== 1) throw Error(`Gurtam control unavailable: ${label}`)
    await control.dispatchEvent('click')
  }
}

/** Gurtam's application is a native form; its hidden values are populated by visible custom controls. */
export async function inspectGurtam(page: Page): Promise<FormInspection> {
  if (await page.locator(formSelector).count() !== 1) throw Error('Gurtam application form unavailable')
  const policy = await inspectForm(page)
  const form = await page.evaluate((selector): FormInspection => {
    const form = document.querySelector<HTMLFormElement>(selector)!
    const knownRequired = new Set(['first_name', 'last_name', 'email', 'country', 'channel', 'brand_awareness', 'source', 'button-upload', 'employment-candidate-privacy-policy', 'consent'])
    for (const el of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-js="required"], [required], [aria-required="true"]')) {
      const visible = !!(el.getClientRects().length || el.closest('.select')?.getClientRects().length || el.closest('label')?.getClientRects().length)
      if (visible && !knownRequired.has(el.id)) throw Error('Unknown required Gurtam application control')
    }
    const fields: Field[] = []
    for (const id of ['first_name', 'last_name', 'email', 'phone', 'link', 'cover_letter', 'referral']) {
      const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)
      if (!el || !el.getClientRects().length) continue
      const label = form.querySelector<HTMLLabelElement>(`label[for="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() || el.getAttribute('aria-label') || id
      fields.push({ key: `id:${id}`, label, type: el.type || 'textarea', required: el.hasAttribute('data-js') && el.getAttribute('data-js') === 'required', options: [] })
    }
    for (const id of ['country', 'channel', 'brand_awareness', 'source']) {
      const el = form.querySelector<HTMLInputElement>(`#${id}`)
      if (!el || !el.closest('.select')?.getClientRects().length) continue
      const group = el.closest('.select')
      const label = el.closest('.form-field')?.querySelector('label.form-label')?.textContent?.replace(/\s+/g, ' ').trim() || group?.querySelector<HTMLInputElement>('.select-input:not(.select-input-hidden)')?.getAttribute('aria-label') || id
      const options = [...(group?.querySelectorAll<HTMLElement>('.select-option') ?? [])].map(option => option.textContent?.trim() ?? '').filter(Boolean)
      fields.push({ key: `id:${id}`, label, type: 'gurtam-select', required: el.getAttribute('data-js') === 'required', options })
    }
    const upload = form.querySelector<HTMLInputElement>('#button-upload[type="file"]')
    if (upload) fields.push({ key: 'id:button-upload', label: 'Resume/CV', type: 'file', required: true, options: [] })
    for (const id of ['employment-candidate-privacy-policy', 'consent']) {
      const el = form.querySelector<HTMLInputElement>(`#${id}[type="checkbox"]`)
      if (!el || !el.closest('label')?.getClientRects().length) continue
      fields.push({ key: `id:${id}`, label: el.closest('label')?.textContent?.replace(/\s+/g, ' ').trim() || id, type: 'checkbox', required: el.getAttribute('data-js') === 'required', options: [] })
    }
    const text = document.body.innerText
    return { fields, text, url: location.href, closed: /no longer accepting applications|position has been filled|job not found/i.test(text), aiBan: false }
  }, formSelector)
  return { ...form, aiBan: policy.aiBan, minimumDaysBetweenApplications: policy.minimumDaysBetweenApplications }
}

export async function fillGurtam(page: Page, candidate: Candidate, answers: Answers, synchronize: () => Promise<void>): Promise<void> {
  const form = page.locator(formSelector)
  const inspection = await inspectGurtam(page)
  for (const field of inspection.fields) {
    if (field.type === 'file') {
      const bytes = await readFile(candidate.cv.path)
      if (bytes.length === 0 || bytes.length >= 5_242_880) throw Error('Gurtam CV must be smaller than 5 MiB')
      await form.locator('#button-upload').setInputFiles({ name: candidate.cv.fileName, mimeType: 'application/pdf', buffer: bytes })
      await synchronize()
      await page.waitForFunction(([selector, fileName]) => document.querySelector<HTMLInputElement>(`${selector} #cv`)?.value === fileName, [formSelector, candidate.cv.fileName], { timeout: 5_000 }).catch(() => { throw Error('Gurtam did not acknowledge selected CV') })
      continue
    }
    const answer = answers.values[field.key]
    if (!answer) continue
    const id = field.key.slice(3)
    if (field.type === 'gurtam-select') {
      if (!selectIds.includes(id as typeof selectIds[number]) || !field.options.includes(answer.value)) throw Error(`Unrecognized Gurtam selection: ${field.label}`)
      const group = form.locator(`#${id}`).locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," select ")][1]')
      await clickGurtamControl(group.locator('.dropdown-button'), `${id} dropdown`)
      await clickGurtamControl(group.getByText(answer.value, { exact: true }), `${id} option`)
    } else if (field.type === 'checkbox') {
      const input = form.locator(`#${id}`)
      const expected = /^(true|yes|agree)$/i.test(answer.value)
      if (await input.isChecked() !== expected) {
        await input.locator('xpath=ancestor::label[1]').locator('.checkbox-input').click()
        if (await input.isChecked() !== expected) throw Error(`Gurtam checkbox did not save: ${field.label}`)
      }
    }
    else await form.locator(`#${id}`).fill(answer.value)
    await synchronize()
  }
}

export async function verifyGurtam(page: Page, candidate: Candidate, answers: Answers): Promise<string[]> {
  const form = page.locator(formSelector), errors: string[] = []
  for (const field of (await inspectGurtam(page)).fields) {
    const id = field.key.slice(3), answer = answers.values[field.key]
    if (field.type === 'file') {
      const input = form.locator('#button-upload')
      const attached = await input.evaluate(async (el: HTMLInputElement, expected: string) => {
        if (el.files?.length !== 1) return false
        const digest = await crypto.subtle.digest('SHA-256', await el.files[0].arrayBuffer())
        return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') === expected
      }, candidate.cv.sha256)
      if (!attached || await form.locator('#cv').inputValue() !== candidate.cv.fileName || !(await form.locator('#button-upload-label').innerText()).includes(candidate.cv.fileName)) errors.push('CV selection not acknowledged')
    } else if (!answer) { if (field.required) errors.push(`Required answer missing: ${field.label}`) }
    else if (field.type === 'checkbox') {
      if (await form.locator(`#${id}`).isChecked() !== /^(true|yes|agree)$/i.test(answer.value)) errors.push(`Consent not saved: ${field.label}`)
    } else if (field.type === 'gurtam-select') {
      const input = form.locator(`#${id}`)
      const group = input.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," select ")][1]')
      const expected = await group.getByText(answer.value, { exact: true }).getAttribute('data-value')
      if (!expected || await input.inputValue() !== expected || (await group.locator('.select-input:not(.select-input-hidden)').inputValue()).trim() !== answer.value) errors.push(`Selection not saved: ${field.label}`)
    } else if ((await form.locator(`#${id}`).inputValue()).trim() !== answer.value.trim()) errors.push(`Text not saved: ${field.label}`)
  }
  return errors
}
