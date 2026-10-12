import type { Page } from 'playwright'
import type { Field, Answers, Candidate, FormInspection } from '../types.ts'

export async function inspectForm(page: Page): Promise<FormInspection> {
  return page.evaluate(() => {
    const fields: Field[] = []
    const controls = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')]
    const radioNames = new Set<string>()
    const checkboxGroups = new Set<Element>()
    for (const [index, el] of controls.entries()) {
      const type = el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase()
      if (['hidden', 'submit', 'button', 'search'].includes(type) || el.disabled || ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly) || /captcha|security-input/i.test(el.id + ' ' + el.name)) continue
      if (location.hostname.endsWith('.bamboohr.com') && el.id === 'nickname_hpcsaf') continue
      if (el.closest('.ashby-application-form-input-yesno')) continue // Native proxy; the visible buttons are authoritative.
      if (type !== 'file' && el.getAttribute('aria-hidden') === 'true') continue
      if (type !== 'file' && !el.getClientRects().length && type !== 'select') continue
      if (type === 'radio' && radioNames.has(el.name)) continue
      if (type === 'radio') radioNames.add(el.name)
      const container = el.closest('fieldset, [role="group"], .ashby-application-form-field-entry, .application-question, .field')
      const labelled = el.getAttribute('aria-labelledby')?.split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ')
      let label = labelled || el.getAttribute('aria-label') || container?.querySelector('.application-label')?.textContent || [...(el.labels ?? [])].map(l => l.textContent).join(' ') || container?.querySelector('label,legend')?.textContent || el.name || el.id
      if (type === 'radio') label = container?.querySelector('.application-label,legend,label,p')?.textContent || label
      label = String(label ?? '').replace(/\s+/g, ' ').trim()
      if (type === 'file' && /(?:^|[\s_-])(resume|cv)(?:$|[\s_-])/i.test(el.id + ' ' + el.name)) label = /cover/i.test(el.id + ' ' + el.name) ? label : 'Resume/CV'
      if (type === 'file' && location.hostname.endsWith('.bamboohr.com') && el.getAttribute('aria-label') === 'file-input') label = 'Resume/CV'
      if (!label && type === 'file' && !el.required) continue // Optional resume-autofill upload is not the application attachment.
      if (!label && type === 'file') label = 'Required attachment'
      let key = el.id ? `id:${el.id}` : el.name ? `name:${el.name}` : `index:${index}`
      if (type === 'radio' && container) { container.setAttribute('data-external-radio', String(index)); key = `radiogroup:${index}` }
      const options = type === 'select' ? [...(el as HTMLSelectElement).options].map(o => o.text.trim()).filter(Boolean) : type === 'radio' ? controls.filter(x => x.name === el.name).map(x => [...(x.labels ?? [])].map(l => l.textContent).join(' ').trim() || x.value) : []
      if (type === 'checkbox' && container && container.querySelectorAll('input[type="checkbox"]').length > 1) {
        if (checkboxGroups.has(container)) continue
        checkboxGroups.add(container)
        const groupIndex = String(checkboxGroups.size)
        container.setAttribute('data-external-checkgroup', groupIndex)
        const labels = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(x => [...(x.labels ?? [])].map(l => l.textContent).join(' ').trim() || x.value)
        let question = container.querySelector(':scope > label,legend')?.textContent?.trim() ?? container.textContent?.trim() ?? ''
        for (const option of labels) question = question.replace(option, '')
        fields.push({ key: `checkgroup:${groupIndex}`, label: question.replace(/\s+/g, ' ').trim(), type: 'checkbox-group', required: /\*/.test(question) || !!container.querySelector('[class*="required"], [class*="Required"]'), options: labels })
        continue
      }
      const structuredLocation = el.id === 'location-input' && !!container?.querySelector('input#selected-location[type="hidden"]')
      fields.push({ key, label, type: structuredLocation ? 'lever-location' : el.getAttribute('role') === 'combobox' ? 'combobox' : type, required: el.required || el.getAttribute('aria-required') === 'true' || /[*✱]/.test(label) || !!container?.querySelector('[class*="required"], [class*="Required"]'), options })
    }
    for (const [index, button] of [...document.querySelectorAll<HTMLButtonElement>('button[role="combobox"]')].entries()) {
      const container = button.closest('.ashby-application-form-field-entry,fieldset,[role="group"],.field')
      const label = container?.querySelector('label,legend')?.textContent?.trim() ?? button.getAttribute('aria-label') ?? ''
      button.setAttribute('data-external-combobox', String(index))
      fields.push({ key: `button-combobox:${index}`, label, type: 'button-combobox', required: button.getAttribute('aria-required') === 'true' || /\*/.test(label) || !!container?.querySelector('[class*="required"], [class*="Required"]'), options: [] })
    }
    if (location.hostname.endsWith('.bamboohr.com')) {
      const country = document.querySelector<HTMLButtonElement>('button[aria-label^="Country "]')
      const saved = country?.closest('.fab-Select')?.querySelector<HTMLSelectElement>('select[name="countryId.value"]')
      if (country && saved) {
        country.setAttribute('data-external-combobox', 'bamboo-country')
        fields.push({ key: 'button-combobox:bamboo-country', label: 'Country', type: 'button-combobox', required: saved.required, options: [] })
      }
    }
    // Ashby's Yes/No controls are buttons, not inputs.
    for (const [index, group] of [...document.querySelectorAll('.ashby-application-form-field-entry, [data-field-path], fieldset')].entries()) {
      const buttons = [...group.querySelectorAll<HTMLButtonElement>('button')].filter(b => b.hasAttribute('aria-pressed') || b.hasAttribute('aria-checked') || /^(Yes|No)$/.test(b.innerText.trim()))
      if (buttons.length < 2 || (!group.querySelector('.ashby-application-form-input-yesno') && group.querySelector('input,textarea,select'))) continue
      const label = group.querySelector('label')?.textContent?.trim() ?? (group.textContent ?? '').replace(/Yes\s*No\s*$/, '').trim()
      group.setAttribute('data-external-toggle', String(index))
      fields.push({ key: `toggle:${index}`, label, type: 'toggle', required: /\*/.test(label) || !!group.querySelector('[class*="required"], [class*="Required"]'), options: buttons.map(b => b.innerText.trim()) })
    }
    const text = document.body.innerText
    const cooldown = text.match(/(?:not apply to more than (?:1|one) role|one application|(?:1|one) role).{0,60}?(\d+)\s*days?\s*(?:window|period)?/i)
    const aiBan = /(?:do not|must not|please (?:avoid|refrain)).{0,60}(?:use|using).{0,30}(?:AI|artificial intelligence|ChatGPT)|AI[- ](?:written|generated) applications.{0,30}(?:not accepted|prohibited)|(?:use of AI|AI[- ]generated|generated content).{0,80}(?:will disqualify|grounds for disqualification)/i.test(text.replace(/\s+/g, ' '))
    return { fields, text, url: location.href, minimumDaysBetweenApplications: cooldown ? Number(cooldown[1]) : undefined, closed: /no longer accepting applications|job (?:has been|is) closed|position has been filled|job not found/i.test(text), aiBan }
  })
}
export function fieldLocator(page: Page, field: Field) {
  const separator = field.key.indexOf(':'), kind = field.key.slice(0, separator), value = field.key.slice(separator + 1)
  if (kind === 'id') return page.locator(`[id=${JSON.stringify(value)}]`)
  if (kind === 'name') return page.locator(`[name=${JSON.stringify(value)}]`).first()
  if (kind === 'toggle') return page.locator(`[data-external-toggle=${JSON.stringify(value)}]`)
  if (kind === 'checkgroup') return page.locator(`[data-external-checkgroup=${JSON.stringify(value)}]`)
  if (kind === 'radiogroup') return page.locator(`[data-external-radio=${JSON.stringify(value)}]`)
  if (kind === 'button-combobox') return page.locator(`[data-external-combobox=${JSON.stringify(value)}]`)
  return page.locator('input,textarea,select').nth(Number(value))
}
export async function fillFields(page: Page, candidate: Candidate, answers: Answers, synchronize: () => Promise<void>) {
  // Re-resolve controls after changes; final inspection rejects unanswered conditional sections.
  const initial = await inspectForm(page)
  const ordered = [...initial.fields].sort((a, b) => Number(/location|city/i.test(a.label)) - Number(/location|city/i.test(b.label)))
  const uploadedResumeKeys: string[] = []
  for (const field of ordered) {
    const answer = answers.values[field.key]
    if (field.type === 'file') {
      if (!/resume|\bcv\b/i.test(field.label)) { if (field.required) throw Error(`Required attachment: ${field.label}`); continue }
      await fieldLocator(page, field).setInputFiles({ name: candidate.cv.fileName, mimeType: 'application/pdf', buffer: await (await import('node:fs/promises')).readFile(candidate.cv.path) })
      uploadedResumeKeys.push(field.key)
      await synchronize(); continue
    }
    if (!answer) continue
    const el = fieldLocator(page, field)
    if (field.type === 'toggle') await el.getByRole('button', { name: answer.value, exact: true }).click()
    else if (field.type === 'checkbox-group') {
      const selected = checkboxSelections(answer.value)
      if (selected.some(value => !field.options.includes(value))) throw Error(`Unrecognized checkbox option: ${field.label}`)
      for (const option of field.options) await el.getByRole('checkbox', { name: option, exact: true }).setChecked(selected.includes(option))
    }
    else if (field.type === 'button-combobox') { await el.click(); await page.getByRole(field.key === 'button-combobox:bamboo-country' ? 'menuitem' : 'option', { name: answer.value, exact: true }).click() }
    else if (field.type === 'select') await el.selectOption({ label: answer.value })
    else if (field.type === 'radio') await (field.key.startsWith('radiogroup:') ? el : page).getByRole('radio', { name: answer.value, exact: true }).check()
    else if (field.type === 'checkbox') await el.setChecked(/^(true|yes|agree)$/i.test(answer.value))
    else if (field.type === 'lever-location') {
      if (!answer.value.trim() && !field.required) {
        await el.fill(''); await el.press('Tab'); await synchronize(); continue
      }
      // Lever only schedules its debounced search from keydown, not the input event emitted by fill().
      await el.fill(''); await el.pressSequentially(answer.value)
      const container = el.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," application-question ")][1]')
      const options = container.locator('.dropdown-results > *')
      await options.first().waitFor({ state: 'visible', timeout: 10000 })
      const labels = await options.allTextContents()
      const normalize = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase()
      // A reviewed exact label disambiguates case variants/aliases without guessing a country.
      const exact = labels.map((label, i) => ({ label, i })).filter(({ label }) => label.trim() === answer.value.trim())
      const matches = exact.length === 1 ? exact : labels.map((label, i) => ({ label: normalize(label), i })).filter(({ label }) => label === normalize(answer.value) || !!candidate.facts.city?.value && !!candidate.facts.country?.value && label.includes(normalize(candidate.facts.city.value)) && label.includes(normalize(candidate.facts.country.value)))
      if (matches.length !== 1) throw Error(`Ambiguous location selection: ${field.label}; suggestions: ${JSON.stringify(labels)}`)
      await options.nth(matches[0].i).click()
    }
    else if (field.type === 'combobox') {
      await el.click(); await el.fill(answer.value)
      if (await el.getAttribute('aria-expanded') === 'false') await el.press('ArrowDown')
      await page.getByRole('option').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
      let options = page.getByRole('option', { name: answer.value, exact: true })
      if (await options.count() !== 1) options = page.getByRole('option').filter({ hasText: answer.value })
      if (await options.count() !== 1) {
        const factOptions = page.getByRole('option').filter({ hasText: candidate.facts.city?.value ?? '__none__' }).filter({ hasText: candidate.facts.country?.value ?? '__none__' })
        if (await factOptions.count() !== 1) throw Error(`Ambiguous autocomplete: ${field.label}`)
        options = factOptions
      }
      await options.first().click()
    } else {
      await el.fill(answer.value); await page.keyboard.press('Tab')
    }
    await synchronize()
  }
  return uploadedResumeKeys
}

/** An ATS may replace its uploaded file input with a filename chip. No question may be added or changed. */
export function verifiedUploadOnlyDrift(before: Field[], after: Field[], uploadedResumeKeys: readonly string[]): boolean {
  const prior = new Map(before.map(field => [field.key, field]))
  const current = new Map(after.map(field => [field.key, field]))
  if (after.some(field => !prior.has(field.key) || JSON.stringify(prior.get(field.key)) !== JSON.stringify(field))) return false
  const removed = before.filter(field => !current.has(field.key))
  return removed.length === 1 && removed[0].type === 'file' && /resume|\bcv\b/i.test(removed[0].label) && uploadedResumeKeys.includes(removed[0].key)
}
export async function verifyFields(page: Page, candidate: Candidate, answers: Answers): Promise<string[]> {
  const inspection = await inspectForm(page), errors: string[] = []
  for (const field of inspection.fields) {
    const answer = answers.values[field.key], el = fieldLocator(page, field)
    if (field.type === 'file') {
      if (/resume|\bcv\b/i.test(field.label)) {
        const expectedHash = candidate.cv.sha256
        const attached = await el.evaluate(async (e: HTMLInputElement, expected: string) => {
          if (!e.files?.length) return false
          if (e.files.length !== 1) throw Error('Unexpected CV attachment count')
          const digest = await crypto.subtle.digest('SHA-256', await e.files[0].arrayBuffer())
          if (Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') !== expected) throw Error('Uploaded CV bytes do not match selected artifact')
          return true
        }, expectedHash)
        if (!attached && !(await page.getByText(candidate.cv.fileName, { exact: false }).count())) errors.push(`Attachment not confirmed: ${field.label}`)
      } else if (field.required) errors.push(`Required attachment missing: ${field.label}`)
      continue
    }
    if (!answer) { if (field.required) errors.push(`Required answer missing: ${field.label}`); continue }
    if (field.type === 'toggle') {
      const saved = await el.getByRole('button', { name: answer.value, exact: true }).evaluate(button => button.getAttribute('aria-pressed') === 'true' || button.getAttribute('aria-checked') === 'true' || button.getAttribute('data-state') === 'checked' || /(?:^|[ _-])selected(?:[ _-]|$)/i.test(button.className))
      if (!saved) errors.push(`Toggle not saved: ${field.label}`)
    } else if (field.type === 'checkbox-group') {
      const selected = checkboxSelections(answer.value)
      const checked = await el.getByRole('checkbox', { checked: true }).count()
      if (checked !== selected.length || (await Promise.all(selected.map(value => el.getByRole('checkbox', { name: value, exact: true }).isChecked()))).some(value => !value)) errors.push(`Checkbox group not saved: ${field.label}`)
    } else if (field.type === 'button-combobox') {
      if (!(await el.innerText()).includes(answer.value)) errors.push(`Selection not saved: ${field.label}`)
      if (field.key === 'button-combobox:bamboo-country' && !await el.evaluate((e, expected) => {
        const selected = e.closest('.fab-Select')?.querySelector<HTMLSelectElement>('select[name="countryId.value"]')?.selectedOptions[0]
        return !!selected?.value && selected.textContent?.trim() === expected
      }, answer.value)) errors.push(`Country backing value not saved: ${field.label}`)
    } else if (field.type === 'radio') {
      if (!(await (field.key.startsWith('radiogroup:') ? el : page).getByRole('radio', { name: answer.value, exact: true }).isChecked())) errors.push(`Radio not saved: ${field.label}`)
    } else if (field.type === 'checkbox') {
      if (await el.isChecked() !== /^(true|yes|agree)$/i.test(answer.value)) errors.push(`Checkbox not saved: ${field.label}`)
    } else if (field.type === 'select') {
      if ((await el.locator('option:checked').innerText()).trim() !== answer.value) errors.push(`Selection not saved: ${field.label}`)
    } else if (field.type === 'lever-location') {
      const stored = await el.evaluate(e => ({ visible: (e as HTMLInputElement).value, selected: e.closest('.application-question')?.querySelector<HTMLInputElement>('#selected-location')?.value }))
      if (!answer.value.trim() && !field.required) {
        if (stored.visible || stored.selected) errors.push(`Optional location not cleared: ${field.label}`)
        continue
      }
      let selectedName: string | undefined
      try { selectedName = JSON.parse(stored.selected ?? '').name } catch { /* Unacknowledged structured location. */ }
      const text = stored.visible.toLowerCase(), exact = text === answer.value.toLowerCase()
      const locationMatches = !!candidate.facts.city?.value && !!candidate.facts.country?.value && text.includes(candidate.facts.city.value.toLowerCase()) && text.includes(candidate.facts.country.value.toLowerCase())
      if (!selectedName || selectedName !== stored.visible || !exact && !locationMatches) errors.push(`Location not saved: ${field.label}`)
    } else if (field.type === 'combobox') {
      const selected = await el.evaluate(e => e.closest('.select-shell,.ashby-application-form-field-entry,.field')?.textContent ?? '')
      const value = await el.inputValue()
      if (!selected.toLowerCase().includes(answer.value.toLowerCase()) && !value.toLowerCase().includes(answer.value.toLowerCase())) {
        // Dialing-country controls collapse "Georgia +995" to "+995". Read the selected option back.
        await el.click()
        if (await el.getAttribute('aria-expanded') === 'false') await el.press('ArrowDown')
        const saved = await page.getByRole('option', { name: answer.value, exact: true, selected: true }).isVisible().catch(() => false)
        await el.press('Escape')
        if (!saved) errors.push(`Autocomplete not saved: ${field.label}`)
      }
      const requiredProxySaved = await el.evaluate(e => [...(e.closest('.select-shell')?.querySelectorAll<HTMLInputElement>('input[aria-hidden="true"][required]') ?? [])].every(input => !!input.value))
      if (!requiredProxySaved) errors.push(`Autocomplete required value not saved: ${field.label}`)
    } else if (field.type === 'tel') {
      const actual = (await el.inputValue()).replace(/\D/g, ''), expected = answer.value.replace(/\D/g, '')
      const prefix = await el.evaluate(e => e.closest('.iti')?.querySelector<HTMLButtonElement>('.iti__selected-country')?.title.match(/\+(\d+)/)?.[1] ?? '')
      if (actual !== expected && prefix + actual !== expected) errors.push(`Phone not saved: ${field.label}`)
    } else if ((await el.inputValue()).trim() !== answer.value.trim()) errors.push(`Text not saved: ${field.label}`)
  }
  return errors
}
function checkboxSelections(value: string): string[] {
  const values = value.startsWith('[') ? JSON.parse(value) : [value]
  if (!Array.isArray(values) || values.some(v => typeof v !== 'string')) throw Error('Checkbox groups require an option string or JSON array of option strings')
  return [...new Set(values)]
}
