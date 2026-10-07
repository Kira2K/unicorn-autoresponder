import { requestNativeResumeClone } from './hh-duplicate.ts'
import { readResumePublication } from './hh-activation.ts'
import { fillProfileLanguages } from './hh-languages.ts'
import { orderedSkillCandidates } from './skill-selection.ts'
import fs from 'node:fs'
import path from 'node:path'
import { ensureThirtyAdvanced, type SavedSkills } from './skill-contract.ts'
import { contentText } from './content-policy.ts'
import { readResumeContract } from './hh-contract-reader.ts'
import { preserveFirstObservation } from './preservation-state.ts'
export { ensureResumeEnglish } from './hh-resume-language.ts'
import type { Locator, Page } from 'playwright'
import { profileFillerError } from './errors.ts'
import { installHhCookieConsentHandler } from './hh-overlays.ts'
import { hhLanguageUiName } from './language-policy.ts'
import { applyEmployerCandidatesOneAtATime, EmployerSelectionNotPersistedError,
  employerNameKey, resolveOfficialEmployerOptions } from './employer-stop-list.ts'
import type { CvEducation, CvExperience, CvLanguage, EmployerCandidate,
  EmployerSelectionOutcome, PreparedProfile, ResumeContractVerification,
  ResumePrivacyVerification } from './types.ts'

// /applicant/resumes opens the unfinished wizard when no published resume
// remains. The profile page is the stable list for published and draft cards.
const HH_RESUMES_URL = 'https://hh.ru/applicant/profile/me'
const HH_NEW_RESUME_URL = 'https://hh.ru/applicant/resumes/new'
export const INITIAL_HH_PROFESSION = 'Программист, разработчик'

export async function captureArtifactScreenshot(page: Page, file: string): Promise<boolean> {
  try {
    // Full-page capture on HH can wait indefinitely while the profile page
    // keeps relaying out. A viewport capture is sufficient evidence and must
    // never turn an otherwise safe run into a production failure.
    await page.screenshot({ path: file, fullPage: false, timeout: 15_000,
      animations: 'disabled' })
    return true
  } catch {
    return false
  }
}

export type ResumeSnapshot = {
  id: string
  title: string
  href: string
  statusText?: string
  isDraft: boolean
}

type ProfessionState = {
  stage: string
  url: string
  screen?: string | null
  controls: Array<Record<string, string | boolean | null>>
}

async function professionState(page: Page, stage: string): Promise<ProfessionState> {
  const controls = await page.locator(
    'button:visible, input[type="radio"], [role="radio"]:visible').evaluateAll(elements =>
    elements.slice(0, 80).map(element => {
      const input = element instanceof HTMLInputElement ? element : undefined
      return {
        tag: element.tagName,
        text: String(element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 200),
        type: input?.type ?? '',
        name: input?.name ?? '',
        value: input?.value ?? '',
        checked: input?.checked ?? element.getAttribute('aria-checked') === 'true',
        disabled: input?.disabled ?? element.getAttribute('aria-disabled') === 'true',
        qa: element.getAttribute('data-qa'),
        role: element.getAttribute('role')
      }
    })).catch(() => [])
  return {
    stage,
    url: page.url(),
    screen: await page.locator('[data-qa*="resume-profile-screen"]:visible').first()
      .getAttribute('data-qa').catch(() => undefined),
    controls
  }
}

async function firstVisible(locators: Locator[]): Promise<Locator | undefined> {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0)
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index)
      if (await item.isVisible().catch(() => false)) return item
    }
  }
  return undefined
}

async function closeBottomSheets(page: Page, retain = 0): Promise<void> {
  // The nested editor sheet is mounted asynchronously after programmatic input.
  // A subsequent workplace itself also lives in a sheet, so preserve that base
  // sheet and close only editors opened above it.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.waitForTimeout(250)
    const count = await page.locator('[data-qa="bottom-sheet-content"]:visible').count()
    if (count > retain) {
      await page.keyboard.press('Escape').catch(() => undefined)
    }
  }
  if (await page.locator('[data-qa="bottom-sheet-content"]:visible').count() > retain) {
    throw profileFillerError('profile_hh_bottom_sheet_blocked',
      'HH did not close an editor panel after preserving its value.', 'fill_resume')
  }
}

const AREA_SHEET_HEADING = /(?:Город или регион проживания|City or region of residence)/i

function areaSelectionValue(value: string): string {
  const city = value.split(',')[0]?.trim() || value.trim()
  return /^tbilisi$/i.test(city) ? 'Тбилиси' : city
}

async function exactAreaSuggestion(sheet: Locator, value: string): Promise<Locator | undefined> {
  const exactText = sheet.getByText(value, { exact: true }).filter({ visible: true })
  return await firstVisible([
    sheet.getByRole('option', { name: value, exact: true }),
    sheet.locator('[data-qa="cell-left-side"]').filter({ has: exactText }),
    exactText
  ])
}

async function visibleAreaSheet(page: Page, value: string): Promise<Locator | undefined> {
  const sheets = page.locator('[data-qa="bottom-sheet-css-variables"]')
  const count = await sheets.count().catch(() => 0)
  for (let index = count - 1; index >= 0; index -= 1) {
    const sheet = sheets.nth(index)
    const heading = await firstVisible([sheet.getByText(AREA_SHEET_HEADING)])
    if (heading || await exactAreaSuggestion(sheet, value)) return sheet
  }

  // HH can portal the visible heading beside a zero-sized bottom-sheet root.
  // The root itself then fails Playwright's visibility check even though its
  // result rows receive pointer events, so resolve it by structure instead.
  const heading = await firstVisible([page.getByText(AREA_SHEET_HEADING)])
  if (!heading) return undefined
  const owner = heading.locator(
    'xpath=ancestor::*[@data-qa="bottom-sheet-css-variables"][1]')
  if (await owner.count().catch(() => 0)) return owner
  for (let index = count - 1; index >= 0; index -= 1) {
    const sheet = sheets.nth(index)
    if (await exactAreaSuggestion(sheet, value)) return sheet
  }
  return undefined
}

async function waitForAreaSheetToClose(page: Page, value: string): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await visibleAreaSheet(page, value))) return true
    await page.waitForTimeout(250)
  }
  return !(await visibleAreaSheet(page, value))
}

async function selectAreaSuggestion(page: Page, value: string,
  required = false): Promise<boolean> {
  const sheet = await visibleAreaSheet(page, value)
  if (!sheet) {
    if (required) throw profileFillerError('profile_hh_area_not_accepted',
      `HH did not show an exact city result for "${value}".`, 'fill_resume')
    return false
  }
  const option = await exactAreaSuggestion(sheet, value)
  if (!option) throw profileFillerError('profile_hh_area_not_accepted',
    `HH did not show an exact city result for "${value}".`, 'fill_resume')
  await option.click({ timeout: 5000 }).catch(() => undefined)
  if (!(await waitForAreaSheetToClose(page, value))) {
    throw profileFillerError('profile_hh_area_not_accepted',
      `HH did not accept the city result "${value}".`, 'fill_resume')
  }
  const saved = await field(page, ['Город', 'City', 'Location'], [
    '[data-qa="profile-common-edit-area"]',
    '[data-qa="resume-block-personal-information-area"] input',
    'input[name="area"]'
  ])
  if (saved && String(await saved.inputValue().catch(() => '')).trim() !== value.trim()) {
    throw profileFillerError('profile_hh_area_not_accepted',
      `HH did not preserve the selected city "${value}".`, 'fill_resume')
  }
  return true
}

async function field(page: Page, names: string[], selectors: string[] = []): Promise<Locator | undefined> {
  const locators = selectors.map(selector => page.locator(selector))
  for (const name of names) {
    locators.push(page.getByLabel(name, { exact: false }))
    locators.push(page.getByPlaceholder(name, { exact: false }))
  }
  return await firstVisible(locators)
}

async function fill(page: Page, value: string | undefined, names: string[],
  selectors: string[] = [], required = false): Promise<boolean> {
  if (!value) return false
  const locator = await field(page, names, selectors)
  if (!locator) {
    if (required) throw profileFillerError('profile_hh_required_field_missing',
      `Required HH field was not found: ${names[0]}.`, 'fill_resume')
    return false
  }
  const current = String(await locator.inputValue().catch(() => '')).trim()
  if (current.replace(/\r\n/g, '\n') === value.trim().replace(/\r\n/g, '\n')) return true
  await locator.fill(value)
  return true
}

const PROFESSION_FIELD_NAMES = ['Профессия', 'Profession', 'Желаемая должность', 'Position']
const PROFESSION_FIELD_SELECTORS = [
  '[data-qa="resume-profile-position-input"]',
  'input[name="title"]',
  '[data-qa="resume-block-title-position"] input',
  '[data-qa*="title"] input'
]

export async function openProfessionEditor(page: Page): Promise<Locator> {
  let input = await field(page, PROFESSION_FIELD_NAMES, PROFESSION_FIELD_SELECTORS)
  if (input) return input

  const entryLocators = [page.locator('[data-qa="resume-profile-card-select-job"]'),
    page.locator('body *').filter({ hasText: /^\s*Укажу\s+профессию\s*$/i }),
    page.getByText(/Укажу\s+профессию/i),
    page.getByText(/^(?:specify|choose|select).*(?:profession|job role)$/i)]
  let entry: Locator | undefined
  for (let attempt = 0; attempt < 20 && !entry; attempt += 1) {
    entry = await firstVisible(entryLocators)
    if (!entry) await page.waitForTimeout(250)
  }
  if (entry) {
    await entry.click()
    for (let attempt = 0; attempt < 20 && !input; attempt += 1) {
      input = await field(page, PROFESSION_FIELD_NAMES, PROFESSION_FIELD_SELECTORS)
      if (!input) await page.waitForTimeout(250)
    }
  }
  // Some HH builds render the choice as a clickable card without a stable
  // role/data-qa. Its nested text is visible but Playwright's text locator can
  // transiently miss it while the React tree is being hydrated. A DOM click on
  // the exact text node still bubbles through the card's regular click handler.
  if (!input) {
    const clicked = await page.evaluate(() => {
      const normalize = (value: string | null) => String(value ?? '').replace(/\s+/g, ' ').trim()
      const target = [...document.querySelectorAll<HTMLElement>('body *')]
        .find(element => normalize(element.textContent) === 'Укажу профессию')
      if (!target) return false
      target.click()
      return true
    }).catch(() => false)
    if (clicked) {
      for (let attempt = 0; attempt < 40 && !input; attempt += 1) {
        input = await field(page, PROFESSION_FIELD_NAMES, PROFESSION_FIELD_SELECTORS)
        if (!input) await page.waitForTimeout(250)
      }
    }
  }
  if (!input) {
    throw profileFillerError('profile_hh_required_field_missing',
      'Required HH field was not found: Профессия.', 'fill_resume')
  }
  return input
}

async function clickText(page: Page, patterns: RegExp[], required = false): Promise<boolean> {
  for (const pattern of patterns) {
    const locator = page.getByText(pattern).last()
    if (await locator.isVisible().catch(() => false)) {
      await locator.click()
      return true
    }
  }
  if (required) throw profileFillerError('profile_hh_control_missing',
    `Required HH control was not found: ${patterns[0]}.`, 'fill_resume')
  return false
}

async function setCheckboxNearText(page: Page, pattern: RegExp, checked: boolean,
  required = false): Promise<boolean> {
  const labelText = page.getByText(pattern).last()
  if (!(await labelText.isVisible().catch(() => false))) {
    if (required) throw profileFillerError('profile_hh_control_missing',
      `Required HH checkbox was not found: ${pattern}.`, 'configure_privacy')
    return false
  }
  const checkbox = (await labelText.locator('input[type="checkbox"]').count())
    ? labelText.locator('input[type="checkbox"]').first()
    : labelText.locator('xpath=ancestor::label[1]').locator('input[type="checkbox"]').first()
  if (await checkbox.count()) {
    if (await checkbox.isChecked().catch(() => !checked) !== checked) await labelText.click()
  } else if (checked) await labelText.click()
  return true
}

async function setExactWorkPermits(page: Page, verifyOnly = false): Promise<boolean> {
  const permits = [
    { source: 'Грузия', ui: /^Грузия$/i },
    { source: 'Сербия', ui: /^Сербия$/i },
    { source: 'Армения', ui: /^Армения$/i },
    { source: 'Казахстан', ui: /^Казахстан$/i }
  ]
  const activator = await firstVisible([
    page.locator('[role="combobox"]:visible')
      .filter({ hasText: /разрешени\S*\s+на\s+работу/i }),
    page.locator('[data-qa="magritte-select-activator"]:visible')
      .filter({ hasText: /разрешени\S*\s+на\s+работу/i })
  ])
  if (!activator) throw profileFillerError('profile_hh_control_missing',
    'Required HH work-permit select was not found.', 'fill_resume')
  await activator.click()
  await page.waitForTimeout(400)
  const editor = await firstVisible([
    page.locator('[data-qa="bottom-sheet-css-variables"]:visible')
      .filter({ hasText: /Грузия/i }).last(),
    page.locator('[role="dialog"]:visible').filter({ hasText: /Грузия/i }).last(),
    page.locator('[data-qa="magritte-select-option-list"]:visible')
      .filter({ hasText: /Грузия/i }).last()
  ])
  if (!editor) throw profileFillerError('profile_hh_work_permit_editor_missing',
    'HH work-permit editor did not open.', 'fill_resume')

  // Read only checked options in one browser-side batch. Iterating every
  // country through Playwright is both unnecessary and extremely slow.
  const selectedNames = async () => await editor
    .locator('label:has(input[type="checkbox"]:checked)')
    .evaluateAll(elements => elements.map(element => String(element.textContent ?? '')
      .replace(/\s+/g, ' ').trim()).filter(Boolean))
  const wantedNames = permits.map(permit => permit.source)
  const exactSet = (names: string[]) => names.length === wantedNames.length &&
    wantedNames.every(name => names.some(current => current.localeCompare(name, 'ru', {
      sensitivity: 'base'
    }) === 0))
  const currentNames = await selectedNames()
  if (exactSet(currentNames)) {
    await page.keyboard.press('Escape').catch(() => undefined)
    return false
  }
  if (verifyOnly) throw profileFillerError('profile_hh_work_permit_not_persisted',
    `HH persisted a different work-permit set: ${currentNames.join(', ') || 'none'}.`,
    'verify_draft')

  for (const current of currentNames) {
    if (wantedNames.some(name => name.localeCompare(current, 'ru', {
      sensitivity: 'base'
    }) === 0)) continue
    const escaped = current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const text = editor.getByText(new RegExp(`^${escaped}$`, 'i')).last()
    if (!(await text.isVisible().catch(() => false))) throw profileFillerError(
      'profile_hh_work_permit_missing',
      `HH selected work-permit control was not found: ${current}.`, 'fill_resume')
    await text.click()
  }
  for (const permit of permits.filter(permit => !currentNames.some(current =>
    current.localeCompare(permit.source, 'ru', { sensitivity: 'base' }) === 0))) {
    const text = editor.getByText(permit.ui).last()
    const label = text.locator('xpath=ancestor::label[1]')
    const checkbox = label.locator('input[type="checkbox"]').first()
    if (!(await text.isVisible().catch(() => false)) || !(await checkbox.count())) {
      throw profileFillerError('profile_hh_work_permit_missing',
        `HH work permit control was not found: ${permit.source}.`, 'fill_resume')
    }
    if (!(await checkbox.isChecked().catch(() => false))) await text.click()
    if (!(await checkbox.isChecked().catch(() => false))) {
      throw profileFillerError('profile_hh_work_permit_not_selected',
      `HH did not select work permit: ${permit.source}.`, 'fill_resume')
    }
  }
  const resultingNames = await selectedNames()
  if (!exactSet(resultingNames)) throw profileFillerError(
    'profile_hh_work_permit_not_selected',
    `HH did not retain the exact work-permit set: ${resultingNames.join(', ') || 'none'}.`,
    'fill_resume')
  const save = await firstVisible([
    editor.getByRole('button', {
      name: /^(?:Выбрать|Сохранить|Готово|Применить|Choose|Select|Save|Done|Apply)$/i
    }),
    editor.getByText(
      /^(?:Выбрать|Сохранить|Готово|Применить|Choose|Select|Save|Done|Apply)$/i),
    page.getByRole('button', {
      name: /^(?:Выбрать|Сохранить|Готово|Применить|Choose|Select|Save|Done|Apply)$/i
    }).last()
  ])
  if (!save) throw profileFillerError('profile_hh_work_permit_confirm_missing',
    'HH work-permit confirmation control was not found.', 'fill_resume')
  await save.click()
  return true
}

async function updateAndVerifyWorkPermits(page: Page): Promise<void> {
  await page.goto('https://hh.ru/profile/edit/common', {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  const changed = await setExactWorkPermits(page)
  if (!changed) return
  await saveChangesWithoutPublishing(page)
  await page.goto('https://hh.ru/profile/edit/common', {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  await setExactWorkPermits(page, true)
}

function resumeId(href: string): string {
  try {
    const url = new URL(href, HH_RESUMES_URL)
    const id = url.searchParams.get('resume') ??
      url.pathname.match(/\/resume\/([a-z0-9]+)/i)?.[1] ?? ''
    return /^(?:edit|new|search)$/i.test(id) ? '' : id
  } catch {
    const id = href.match(/\/resume\/([a-z0-9]+)/i)?.[1] ?? ''
    return /^(?:edit|new|search)$/i.test(id) ? '' : id
  }
}

export async function dismissStaleResumeContactsPrompt(page: Page): Promise<boolean> {
  const message = await firstVisible([
    page.getByText(/(?:Контакты в резюме могли устареть|Resume contacts may be out of date)/i)
  ])
  if (!message) return false
  const owner = message.locator([
    'xpath=ancestor::*[',
    './/*[self::button or @role="button"]',
    '[normalize-space(.)="Закрыть" or normalize-space(.)="Close"]',
    '][1]'
  ].join(''))
  const close = await firstVisible([
    owner.getByRole('button', { name: /^(?:Закрыть|Close)$/i }),
    owner.getByText(/^(?:Закрыть|Close)$/i, { exact: true })
  ])
  if (!close) throw profileFillerError('profile_hh_stale_contacts_prompt_blocked',
    'HH stale-resume-contacts prompt has no Close control.', 'list_resumes')
  await close.click({ timeout: 5000 }).catch(() => {
    throw profileFillerError('profile_hh_stale_contacts_prompt_blocked',
      'HH stale-resume-contacts prompt Close control could not be clicked.', 'list_resumes')
  })
  await message.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
  if (await message.isVisible().catch(() => false)) throw profileFillerError(
    'profile_hh_stale_contacts_prompt_blocked',
    'HH stale-resume-contacts prompt remained visible after Close.', 'list_resumes')
  return true
}

export async function listResumes(page: Page): Promise<ResumeSnapshot[]> {
  let activePage = page
  let freshPage: Page | undefined
  let ready = false
  for (let attempt = 0; attempt < 3 && !ready; attempt += 1) {
    if (attempt === 2) {
      freshPage = await page.context().newPage()
      await installHhCookieConsentHandler(freshPage)
      activePage = freshPage
    }
    try {
      await activePage.goto(HH_RESUMES_URL, {
        waitUntil: 'domcontentloaded', timeout: attempt === 0 ? 120_000 : 60_000
      })
      ready = await activePage.locator('body').evaluate(element =>
        Boolean(element.textContent?.trim().length)).catch(() => false)
    } catch {
      await activePage.evaluate(() => window.stop()).catch(() => undefined)
    }
    if (!ready) await activePage.waitForTimeout(1000)
  }
  if (!ready) {
    await freshPage?.close().catch(() => undefined)
    throw profileFillerError('profile_hh_navigation_failed',
      'HH resume list did not load after three bounded attempts.', 'list_resumes')
  }
  await activePage.waitForTimeout(1500)
  await dismissStaleResumeContactsPrompt(activePage)
  // The current applicant profile hides incomplete resumes in the compact list
  // until any resume action menu is opened. Expanding it is read-only and lets
  // replacement/duplication verification see drafts as well as published cards.
  const compactTrigger = await firstVisible([
    activePage.locator('[data-qa="resume-list-action-more"]'),
    activePage.getByRole('button', { name: /^Все резюме\s*\d*$/i }),
    activePage.getByText(/^Все резюме\s*\d*$/i, { exact: true })
  ])
  if (compactTrigger) {
    await compactTrigger.click()
    await activePage.waitForTimeout(200)
  }
  const anchors = activePage.locator([
    'a[data-qa^="resume-title-link"]',
    'a[data-qa^="resume-card-link-"]',
    'a[data-qa="resume-button-edit-resume"]',
    'a[href*="/profile/resume?resume="]',
    'a[href*="/applicant/resumes/"]'
  ].join(','))
  const result = new Map<string, ResumeSnapshot>()
  for (let index = 0; index < await anchors.count(); index += 1) {
    const anchor = anchors.nth(index)
    const href = String(await anchor.getAttribute('href') ?? '')
    const id = resumeId(href)
    if (!id) continue
    const draftCard = anchor.locator('xpath=ancestor::*[@data-qa="resume"][1]')
    const card = await draftCard.count()
      ? draftCard.first()
      : anchor.locator('xpath=ancestor::*[self::div or self::article][1]')
    const rawTitle = String(await anchor.innerText().catch(() => '')).trim()
    const titleSource = /^дополнить|continue filling$/i.test(rawTitle)
      ? String(await card.innerText().catch(() => rawTitle)).trim()
      : rawTitle
    const title = titleSource.split(/\r?\n/).map(line => line.trim()).find(line =>
      line && !/^(?:постоянная работа|частичная занятость|стажировка|проектная работа|full[- ]?time|part[- ]?time|internship|не\s*опубликовано|draft|уровень дохода|salary|\d+\s+ваканс)/i.test(line)) ?? rawTitle
    const statusText = String(await card.innerText().catch(() => '')).trim()
    const absoluteHref = new URL(href, HH_RESUMES_URL).toString()
    if (result.has(id)) continue
    result.set(id, { id, title, href: absoluteHref,
      statusText, isDraft: /черновик|draft|не\s*опубликовано|заполните резюме|continue filling/i.test(statusText) ||
        /\/profile\/resume\//i.test(new URL(absoluteHref).pathname) })
  }
  await freshPage?.close().catch(() => undefined)
  return [...result.values()]
}

export async function inspectHH(page: Page, artifactDir: string) {
  const resumes = await listResumes(page)
  const createControl = await firstVisible([
    page.locator('[data-qa="resume-create-button"]'),
    page.locator('a[href*="/applicant/resumes/new"]'),
    page.getByText(/создать резюме|create resume/i)
  ])
  await captureArtifactScreenshot(page, path.join(artifactDir, 'dry-run-resumes.png'))
  if (!createControl) {
    throw profileFillerError('profile_hh_create_unavailable',
      'HH resume creation control is unavailable.', 'dry_run_hh')
  }
  await page.goto(HH_NEW_RESUME_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const professionInput = await openProfessionEditor(page)
  const professionControlVisible = await professionInput.isVisible().catch(() => false)
  await captureArtifactScreenshot(page, path.join(artifactDir, 'dry-run-profession.png'))
  const snapshot = { url: page.url(), title: await page.title(), resumes,
    createControlVisible: true, professionControlVisible, inspectedAt: new Date().toISOString() }
  const file = path.join(artifactDir, 'dry-run-hh-snapshot.json')
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 })
  if (!professionControlVisible) {
    throw profileFillerError('profile_hh_required_field_missing',
      'Required HH field is not visible after selecting: Профессия.', 'dry_run_hh',
      { artifact: file })
  }
  return { resumes, artifact: file }
}

export async function setArea(page: Page, value?: string) {
  if (!value) return
  const selectionValue = areaSelectionValue(value)
  const existing = await field(page, ['Город', 'City', 'Location'], [
    '[data-qa="profile-common-edit-area"]',
    '[data-qa="resume-block-personal-information-area"] input',
    'input[name="area"]'
  ])
  if (existing && String(await existing.inputValue().catch(() => '')).trim() === selectionValue) {
    const sheet = await visibleAreaSheet(page, selectionValue)
    if (sheet) {
      const option = await exactAreaSuggestion(sheet, selectionValue)
      if (option) {
        await selectAreaSuggestion(page, selectionValue, true)
      } else {
        await page.keyboard.press('Escape').catch(() => undefined)
        if (!(await waitForAreaSheetToClose(page, selectionValue)) ||
            String(await existing.inputValue().catch(() => '')).trim() !== selectionValue) {
          throw profileFillerError('profile_hh_area_not_accepted',
            `HH did not preserve the selected city "${selectionValue}".`, 'fill_resume')
        }
      }
    }
    return
  }
  const changed = await fill(page, selectionValue, ['Город', 'City', 'Location'], [
    '[data-qa="profile-common-edit-area"]',
    '[data-qa="resume-block-personal-information-area"] input',
    'input[name="area"]'
  ])
  if (!changed) return
  await page.waitForTimeout(700)
  await selectAreaSuggestion(page, selectionValue, true)
}

export async function setExperienceResumePropagation(page: Page,
  targetResumeIds: string[]): Promise<boolean> {
  const targetIds = new Set(targetResumeIds)
  const checkboxes = page.locator('input[type="checkbox"][name]')
  const count = await checkboxes.count().catch(() => 0)
  if (!count) {
    const labels = page.locator('label:has(input[type="checkbox"])')
    let resumeCount = 0
    for (let index = 0; index < await labels.count(); index += 1) {
      const label = labels.nth(index)
      const text = String(await label.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      if (!text || /^Работаю сейчас$|^Currently work here$/i.test(text)) continue
      const checkbox = label.locator('input[type="checkbox"]').first()
      if (!(await checkbox.count().catch(() => 0))) continue
      resumeCount += 1
      if (!(await checkbox.isChecked().catch(() => false))) {
        if (await checkbox.isDisabled().catch(() => false)) throw profileFillerError(
          'profile_hh_experience_propagation_blocked',
          `HH disabled the resume propagation control for "${text}".`, 'fill_resume')
        await label.click()
      }
      if (!(await checkbox.isChecked().catch(() => false))) throw profileFillerError(
        'profile_hh_experience_propagation_blocked',
        `HH did not apply experience propagation for "${text}".`, 'fill_resume')
    }
    return resumeCount > 0
  }
  for (let index = 0; index < count; index += 1) {
    const checkbox = checkboxes.nth(index)
    const name = String(await checkbox.getAttribute('name') ?? '')
    if (!name) continue
    const shouldBeChecked = targetIds.has(name)
    const checked = await checkbox.isChecked().catch(() => false)
    if (checked !== shouldBeChecked) {
      if (await checkbox.isDisabled().catch(() => false)) throw profileFillerError(
        'profile_hh_experience_propagation_blocked',
        `HH disabled the resume propagation control for ${name} in an unexpected state.`,
        'fill_resume')
      const label = checkbox.locator('xpath=ancestor::label[1]')
      if (await label.isVisible().catch(() => false)) await label.click()
      else await checkbox.click()
    }
    if (await checkbox.isChecked().catch(() => false) !== shouldBeChecked) {
      throw profileFillerError('profile_hh_experience_propagation_blocked',
        `HH did not apply the required experience propagation state for resume ${name}.`,
        'fill_resume')
    }
  }
  return true
}

async function attachExistingProfileExperience(page: Page, item: CvExperience,
  targetResumeIds: string[], requiredResumeId: string, artifactDir: string): Promise<void> {
  let marker: Locator | undefined
  for (const sourceResumeId of targetResumeIds) {
    await page.goto(`https://hh.ru/resume/${encodeURIComponent(sourceResumeId)}/experience`, {
      waitUntil: 'domcontentloaded', timeout: 120_000
    })
    await page.waitForTimeout(1000)
    if (!/\/resume\/[a-z0-9]+\/experience/i.test(new URL(page.url()).pathname)) continue
    marker = await firstVisible([
      page.getByText(item.company, { exact: true }),
      page.getByText(item.company, { exact: false }),
      page.getByText(item.title, { exact: true }),
      page.getByText(item.title, { exact: false })
    ])
    if (marker) break
  }
  if (!marker) throw profileFillerError('profile_hh_existing_experience_missing',
    `HH profile experience "${item.company}" was not found for resume propagation.`, 'fill_resume')
  const owner = marker.locator(
    'xpath=ancestor::*[.//*[self::a or self::button]' +
    '[normalize-space(.)="Редактировать" or normalize-space(.)="Edit"]][1]')
  const edit = await firstVisible([
    owner.getByRole('button', { name: /^(?:Редактировать|Edit)$/i }),
    owner.getByRole('link', { name: /^(?:Редактировать|Edit)$/i }),
    owner.getByText(/^(?:Редактировать|Edit)$/i, { exact: true })
  ])
  if (edit) await edit.click()
  else {
    const clickable = await firstVisible([
      marker.locator('xpath=ancestor::*[@data-qa="profile-experience-company-card"][1]'),
      marker.locator('xpath=ancestor::*[contains(@class,"press-enabled")][1]'),
      marker.locator('xpath=ancestor::a[1]'),
      marker.locator('xpath=ancestor::button[1]'),
      marker.locator('xpath=ancestor::*[@role="button"][1]')
    ])
    await (clickable ?? marker).click()
  }
  await page.waitForURL(url => /\/profile\/edit\/experience/i.test(url.pathname), {
    timeout: 10_000
  }).catch(() => undefined)
  const companyInput = page.locator(
    '[data-qa*="resume-profile-experience-specific-company-input"]:visible').first()
  if (!(await companyInput.isVisible().catch(() => false))) {
    const ancestry = await marker.evaluate(element => {
      const result: Array<Record<string, string | null>> = []
      let current: Element | null = element
      for (let depth = 0; current && depth < 16; depth += 1, current = current.parentElement) {
        result.push({ tag: current.tagName, id: current.id || null,
          qa: current.getAttribute('data-qa'), role: current.getAttribute('role'),
          href: current.getAttribute('href'), class: current.getAttribute('class') })
      }
      return result
    }).catch(() => [])
    throw profileFillerError('profile_hh_existing_experience_editor_missing',
      `HH did not open the existing experience editor for "${item.company}". ` +
      `Card ancestry: ${JSON.stringify(ancestry)}`, 'fill_resume')
  }
  if (!(await setExperienceResumePropagation(page, targetResumeIds))) throw profileFillerError(
    'profile_hh_experience_propagation_missing',
    `HH exposes no resume propagation controls for "${item.company}".`, 'fill_resume')
  const propagation = await page.locator('input[type="checkbox"]').evaluateAll(inputs =>
    inputs.map(input => ({ name: input.getAttribute('name'), checked: (input as HTMLInputElement).checked,
      disabled: (input as HTMLInputElement).disabled,
      label: input.closest('label')?.innerText.replace(/\s+/g, ' ').trim() ?? '' })))
  fs.writeFileSync(path.join(artifactDir, `propagation-${requiredResumeId}-${Date.now()}.json`),
    `${JSON.stringify(propagation, null, 2)}\n`, { mode: 0o600 })
  await captureArtifactScreenshot(page,
    path.join(artifactDir, `propagation-${requiredResumeId}.png`))
  const required = page.locator(
    `input[type="checkbox"][name="${requiredResumeId}"]`).first()
  const hasNamedResumeControls = propagation.some(item => Boolean(item.name))
  const unnamedResumeSelected = propagation.some(item => !item.name && item.checked &&
    !/^(?:Работаю сейчас|Currently work here)$/i.test(item.label))
  if (hasNamedResumeControls
    ? !(await required.count()) || !(await required.isChecked().catch(() => false))
    : !unnamedResumeSelected) {
    throw profileFillerError('profile_hh_required_experience_propagation_missing',
      `HH did not select resume ${requiredResumeId} while editing "${item.company}".`, 'fill_resume')
  }
  const save = page.locator('[data-qa="profile-layout-save-button"]:visible')
  if (!(await save.isEnabled().catch(() => false))) throw profileFillerError(
    'profile_hh_existing_experience_save_disabled',
    `HH disabled Save while attaching "${item.company}" to the resume.`, 'fill_resume')
  await save.click()
  await save.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
  if (await save.isVisible().catch(() => false)) throw profileFillerError(
    'profile_hh_existing_experience_save_not_applied',
    `HH did not save resume propagation for "${item.company}".`, 'fill_resume')
}

async function resumePublishedFromExperience(page: Page, profile: PreparedProfile,
  actualTitle: string, id: string, artifactDir: string,
  targetResumeIds: string[]): Promise<ResumeSnapshot> {
  const publicUrl = `https://hh.ru/resume/${id}`
  const experienceUrl = `${publicUrl}/experience`
  await page.goto(experienceUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForTimeout(1000)
  for (const item of profile.cv.experience) {
    if (await page.getByText(item.company, { exact: false }).isVisible().catch(() => false)) continue
    await attachExistingProfileExperience(page, item, targetResumeIds, id, artifactDir)
    await page.goto(experienceUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(1000)
    if (!(await page.getByText(item.company, { exact: false }).isVisible().catch(() => false))) {
      throw profileFillerError('profile_hh_published_experience_not_attached',
        `HH did not attach "${item.company}" to resume ${id}.`, 'fill_resume')
    }
  }
  await captureArtifactScreenshot(page,
    path.join(artifactDir, `verified-experience-${id}.png`))
  return { id, title: actualTitle, href: publicUrl,
    statusText: 'experience verified in published HH resume', isDraft: false }
}

async function addPublishedExperience(page: Page, item: CvExperience,
  targetResumeIds: string[] = [], options: {
    editorAlreadyOpen?: boolean
    artifactDir?: string
  } = {}): Promise<boolean> {
  if (!options.editorAlreadyOpen) {
    const add = await firstVisible([
      page.getByRole('button', { name: /^Добавить$|^Add$/i }),
      page.getByText(/^Добавить$|^Add$/i).last()
    ])
    if (!add) throw profileFillerError(
      'profile_hh_published_experience_add_missing', 'Published experience Add control is missing.', 'fill_resume')
    await add.click()
    await page.waitForURL(url => /\/profile\/edit\/experience/i.test(url.pathname), {
      timeout: 10_000
    }).catch(() => undefined)
  }

  const company = page.locator(
    '[data-qa*="resume-profile-experience-specific-company-input"]:visible').first()
  const position = page.locator(
    '[data-qa*="resume-profile-experience-specific-position-input"]:visible').first()
  const responsibilities = page.locator('[data-qa="resume-editor-experience-description-input"]:visible')
  if (!(await company.isVisible().catch(() => false)) ||
      !(await position.isVisible().catch(() => false)) ||
      !(await responsibilities.isVisible().catch(() => false))) throw profileFillerError(
    'profile_hh_published_experience_fields_missing',
    'Published experience editor fields are missing.', 'fill_resume')

  if (targetResumeIds.length && !(await setExperienceResumePropagation(page,
    targetResumeIds))) throw profileFillerError('profile_hh_experience_propagation_missing',
    'HH direct experience editor exposes no resume propagation controls.', 'fill_resume')

  await company.fill(item.company)
  await page.waitForTimeout(500)
  const companySuggestions = page.locator(
    '[data-qa="suggest-item-cell"]:visible, [role="option"]:visible')
  let companySuggestion: Locator | undefined
  for (let index = 0; index < await companySuggestions.count(); index += 1) {
    const candidate = companySuggestions.nth(index)
    if (normalizedExperienceText(await candidate.innerText()) ===
        normalizedExperienceText(item.company)) {
      companySuggestion = candidate
      break
    }
  }
  if (companySuggestion) {
    await companySuggestion.click()
  } else {
    const editor = page.locator(
      '[data-qa="bottom-sheet-content"]:visible input:visible').last()
    if (!(await editor.isVisible().catch(() => false))) throw profileFillerError(
      'profile_hh_published_experience_company_editor_missing',
      'Direct experience company editor did not open.', 'fill_resume')
    await editor.fill(item.company)
    await acceptExperienceFreeText(page, editor, options.artifactDir)
  }
  await page.waitForTimeout(300)
  const savedCompany = page.locator(
    '[data-qa*="resume-profile-experience-specific-company-input"]:visible').first()
  if (normalizedExperienceText(await savedCompany.inputValue().catch(() => '')) !==
      normalizedExperienceText(item.company)) throw profileFillerError(
    'profile_hh_published_experience_company_not_applied',
    'Direct experience editor did not preserve the company.', 'fill_resume')

  await position.fill(item.title)
  await page.waitForTimeout(300)
  const positionEditor = page.locator(
    '[data-qa="bottom-sheet-content"]:visible input:visible').last()
  if (await positionEditor.isVisible().catch(() => false)) {
    await positionEditor.fill(item.title)
    await positionEditor.press('Enter')
  }
  await page.waitForTimeout(300)
  const savedPosition = page.locator(
    '[data-qa*="resume-profile-experience-specific-position-input"]:visible').first()
  if (normalizedExperienceText(await savedPosition.inputValue().catch(() => '')) !==
      normalizedExperienceText(item.title)) throw profileFillerError(
    'profile_hh_published_experience_position_not_applied',
    'Direct experience editor did not preserve the position.', 'fill_resume')
  await responsibilities.fill(item.description)
  await page.waitForTimeout(500)
  const responsibilitiesEditor = page.locator(
    '[data-qa="profile-editor-experience-description-input"]:visible')
  if (await responsibilitiesEditor.isVisible().catch(() => false)) {
    await responsibilitiesEditor.fill(item.description)
    const saveDescription = await firstVisible([
      page.locator('[data-qa="bottom-sheet-container"] button:visible')
        .filter({ hasText: /^Сохранить$|^Save$/i }),
      page.locator('button:visible:not([data-qa="profile-layout-save-button"])')
        .filter({ hasText: /^Сохранить$|^Save$/i })
    ])
    if (saveDescription) await saveDescription.click()
    else await responsibilitiesEditor.press('Control+Enter').catch(() => undefined)
  }
  await closeBottomSheets(page)

  const monthControls = page.locator('[data-qa="magritte-select-activator"]:visible')
  const setMonth = async (controlIndex: number, month: string) => {
    const control = monthControls.nth(controlIndex)
    if (!(await control.isVisible().catch(() => false))) return false
    await control.click()
    const option = page.locator(`[data-qa="magritte-select-option-${month}"]:visible`)
    await option.waitFor({ state: 'visible', timeout: 5000 })
    await option.click()
    await closeBottomSheets(page)
    return true
  }
  const [startMonth, startYear] = (item.startDate ?? '').split('/')
  if (!startMonth || !startYear || !(await setMonth(0, startMonth.padStart(2, '0')))) {
    throw profileFillerError('profile_hh_published_experience_start_date_missing',
      'Published experience start-date controls are missing.', 'fill_resume')
  }
  const startYearControl = page.locator('[data-qa="resume-editor-experience-start-year-input"]:visible')
  await startYearControl.fill(startYear)
  await startYearControl.press('Tab')

  const currentLabel = page.getByText(/^Работаю сейчас$|^Currently work here$/i).last()
  const currentCheckbox = currentLabel.locator('xpath=ancestor::label[1]')
    .locator('input[type="checkbox"]')
  const worksNow = await currentCheckbox.isChecked().catch(() => false)
  if (item.current) {
    if (!worksNow) await currentLabel.click()
  } else if (item.endDate) {
    if (worksNow) await currentLabel.click()
    await page.waitForTimeout(300)
    const [endMonth, endYear] = item.endDate.split('/')
    if (!endMonth || !endYear || !(await setMonth(1, endMonth.padStart(2, '0')))) {
      throw profileFillerError('profile_hh_published_experience_end_date_missing',
        'Published experience end-date controls are missing.', 'fill_resume')
    }
    const endYearControl = page.locator('[data-qa="resume-editor-experience-end-year-input"]:visible')
    await endYearControl.fill(endYear)
    await endYearControl.press('Tab')
  }

  const save = page.locator('[data-qa="profile-layout-save-button"]:visible')
  if (!(await save.isEnabled().catch(() => false))) throw profileFillerError(
    'profile_hh_published_experience_save_disabled',
    'Published experience Save control is disabled after filling.', 'fill_resume')
  await save.click()
  await save.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
  if (await save.isVisible().catch(() => false)) {
    const errors = await page.locator('[role="alert"]:visible, [data-qa*="error"]:visible')
      .allTextContents().catch(() => [])
    throw profileFillerError('profile_hh_published_experience_save_not_applied',
      `Direct experience editor rejected Save${errors.length ? `: ${errors.join('; ')}` : ''}.`,
      'fill_resume')
  }
  await page.waitForTimeout(2500)
  return true
}

export async function saveExperienceResponsibilitiesEditor(page: Page): Promise<boolean> {
  // HH portals the sticky footer beside the nested bottom-sheet content.
  // This runs immediately after filling the responsibilities field, so the
  // separate visible Save action is the stable editor signature. Explicitly
  // exclude the underlying experience-item Save button instead of depending on
  // a heading/content ancestor relationship that changes between HH releases.
  const candidates = page.getByRole('button', { name: /^(?:Сохранить|Save)$/i })
    .filter({ visible: true })
  let save: Locator | undefined
  for (let index = (await candidates.count().catch(() => 0)) - 1; index >= 0; index -= 1) {
    const candidate = candidates.nth(index)
    if (await candidate.getAttribute('data-qa').catch(() => null) ===
      'modal-edit-list-item-save') continue
    save = candidate
    break
  }
  if (!save || !(await save.isVisible().catch(() => false))) return false
  const targetElement = await save.elementHandle()
  if (!targetElement) throw profileFillerError(
    'profile_hh_experience_responsibilities_editor_missing',
    'HH responsibilities editor disappeared before it could be saved.', 'fill_resume')

  await save.click().catch(() => undefined)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const remainsVisible = await targetElement.evaluate(element => {
      if (!element.isConnected) return false
      const style = window.getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        box.width > 0 && box.height > 0
    }).catch(() => false)
    if (!remainsVisible) return true
    await page.waitForTimeout(250)
  }
  throw profileFillerError('profile_hh_experience_responsibilities_save_not_applied',
    'HH kept the responsibilities editor open after Save.', 'fill_resume')
}

export async function closeExperienceTextEditor(page: Page,
  headingPattern: RegExp): Promise<boolean> {
  const heading = await firstVisible([
    page.getByRole('heading', { name: headingPattern, exact: true }),
    page.getByText(headingPattern, { exact: true })
  ])
  if (!heading) return false
  const nestedSheet = heading.locator(
    'xpath=ancestor::*[@data-qa="bottom-sheet-content"][1]')
  if (!(await nestedSheet.count().catch(() => 0))) return false
  const nestedElement = await nestedSheet.elementHandle()
  if (!nestedElement) return false

  const close = await firstVisible([
    nestedSheet.locator('[data-qa="select-bottom-sheet-navigation-close"]:visible'),
    nestedSheet.locator('button[aria-label*="Закры"]:visible'),
    nestedSheet.locator('button[aria-label*="Close" i]:visible'),
    nestedSheet.locator('button:visible').first()
  ])
  if (!close) throw profileFillerError('profile_hh_experience_text_editor_close_missing',
    'HH experience text editor Close control was not found.', 'fill_resume')
  await close.click().catch(() => undefined)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const remainsVisible = await nestedElement.evaluate(element => {
      if (!element.isConnected) return false
      const style = window.getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        box.width > 0 && box.height > 0
    }).catch(() => false)
    if (!remainsVisible) return true
    await page.waitForTimeout(250)
  }
  throw profileFillerError('profile_hh_experience_text_editor_blocked',
    'HH kept the experience text editor open after Close.', 'fill_resume')
}

export async function acceptExperienceFreeText(page: Page, input: Locator,
  artifactDir?: string): Promise<void> {
  let sheet = input.locator('xpath=ancestor::*[@data-qa="bottom-sheet-content"][1]')
  if (!(await sheet.count().catch(() => 0))) {
    const heading = await firstVisible([
      page.getByRole('heading', { name: /^(?:Название компании|Company name)$/i, exact: true }),
      page.getByText(/^(?:Название компании|Company name)$/i, { exact: true })
    ])
    if (heading) sheet = heading.locator(
      'xpath=ancestor::*[@data-qa="bottom-sheet-content"][1]')
  }
  if (!(await sheet.count().catch(() => 0))) {
    await input.press('Tab')
    return
  }
  await input.press('Enter')
  await sheet.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
  if (!(await sheet.isVisible().catch(() => false))) return

  const saveCandidates = page.getByRole('button', {
    name: /^(?:Сохранить|Save)$/i
  }).filter({ visible: true })
  let save: Locator | undefined
  for (let index = (await saveCandidates.count().catch(() => 0)) - 1; index >= 0; index -= 1) {
    const candidate = saveCandidates.nth(index)
    if (await candidate.getAttribute('data-qa').catch(() => null) ===
      'modal-edit-list-item-save') continue
    save = candidate
    break
  }
  if (save) {
    await save.click()
    await sheet.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
  }
  if (await sheet.isVisible().catch(() => false)) {
    await input.press('Escape')
    await sheet.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
  }
  if (await sheet.isVisible().catch(() => false)) {
    if (artifactDir) {
      const controls = await sheet.locator('button, [role="button"], [role="option"], a')
        .evaluateAll(elements => elements.map(element => ({
          tag: element.tagName.toLowerCase(), role: element.getAttribute('role'),
          qa: element.getAttribute('data-qa'), text: String(element.textContent ?? '')
            .replace(/\s+/g, ' ').trim(), ariaLabel: element.getAttribute('aria-label')
        })))
      fs.writeFileSync(path.join(artifactDir, 'experience-company-overlay.json'), JSON.stringify({
        text: String(await sheet.innerText().catch(() => '')).slice(0, 5000), controls
      }, null, 2), { mode: 0o600 })
    }
    throw profileFillerError('profile_hh_experience_text_editor_blocked',
      'HH kept the custom company editor open after Enter and Escape.', 'fill_resume')
  }
}

export async function dismissExperienceOverlayBlocking(page: Page,
  control: Locator): Promise<boolean> {
  const marker = `experience-blocker-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const markBlockingSheet = async () => await control.evaluate((element, token) => {
    const box = element.getBoundingClientRect()
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    if (!top || element.contains(top)) return false
    const blocker = top.closest('[data-qa="bottom-sheet-css-variables"]')
    const owner = element.closest('[data-qa="bottom-sheet-css-variables"]')
    if (!blocker || blocker === owner) return false
    blocker.setAttribute('data-profile-filler-experience-blocker', token)
    return true
  }, marker).catch(() => false)

  if (!(await markBlockingSheet())) return false
  const blocker = page.locator(
    `[data-profile-filler-experience-blocker="${marker}"]`)
  const close = await firstVisible([
    blocker.locator('[data-qa="select-bottom-sheet-navigation-close"]:visible'),
    blocker.locator('button[aria-label*="Закры"]:visible'),
    blocker.locator('button[aria-label*="Close" i]:visible'),
    blocker.locator('button:visible').first()
  ])
  if (!close) throw profileFillerError('profile_hh_experience_date_overlay_close_missing',
    'HH nested experience editor has no Close control.', 'fill_resume')
  await close.click({ timeout: 5000 }).catch(() => {
    throw profileFillerError('profile_hh_experience_date_overlay_close_blocked',
      'HH nested experience editor Close control could not be clicked.', 'fill_resume')
  })
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await blocker.isVisible().catch(() => false))) return true
    if (!(await markBlockingSheet())) return true
    await page.waitForTimeout(250)
  }
  throw profileFillerError('profile_hh_experience_date_overlay_blocked',
    'HH kept a nested experience editor over the date controls.', 'fill_resume')
}

async function addExperience(page: Page, item: CvExperience, currentResumeId?: string,
  artifactDir?: string, targetResumeIds: string[] = []) {
  const trace = (stage: string, details: Record<string, unknown> = {}) => {
    if (!artifactDir) return
    fs.appendFileSync(path.join(artifactDir, 'experience-state.ndjson'), `${JSON.stringify({
      at: new Date().toISOString(), stage, company: item.company,
      path: new URL(page.url()).pathname, ...details
    })}\n`, { mode: 0o600 })
  }
  const wizard = page.locator('[data-qa*="resume-profile-screen_experience"]:visible')
  const publishedEditor = /\/resume\/[a-z0-9]+\/experience/i.test(new URL(page.url()).pathname)
  if (publishedEditor) return await addPublishedExperience(page, item,
    targetResumeIds.length ? targetResumeIds : currentResumeId ? [currentResumeId] : [])
  if (await wizard.isVisible().catch(() => false) || publishedEditor) {
    let itemSheet = await page.locator('[data-qa="modal-edit-list-item-save"]:visible')
      .isVisible().catch(() => false)
    let company = itemSheet
      ? page.locator('[data-qa*="resume-profile-experience-specific-company-input"]:visible').last()
      : page.locator('[data-qa*="resume-profile-experience-specific-company-input"]:visible').first()
    const activeCompanyIsFilled = await company.isVisible().catch(() => false) &&
      Boolean(String(await company.inputValue().catch(() => '')).trim())
    trace('entry', { itemSheet, companyVisible: await company.isVisible().catch(() => false),
      activeCompanyIsFilled })
    if (!(await company.isVisible().catch(() => false)) || (!itemSheet && activeCompanyIsFilled)) {
      // The list action is rendered next to the screen portal, not inside the
      // screen subtree itself.
      let add = await firstVisible([
        page.locator('button[data-qa="list-add"]:visible').filter({ hasText: /^Добавить$|^Add$/i }),
        page.getByRole('button', { name: /^Добавить$|^Add$/i })
      ])
      if (!add) throw profileFillerError('profile_hh_experience_add_missing',
        'HH experience Add control was not found.', 'fill_resume')
      trace('add-found', { enabled: await add.isEnabled().catch(() => false) })
      for (let attempt = 0; attempt < 2 && !itemSheet; attempt += 1) {
        for (let ready = 0; ready < 60 &&
          !(await add.isEnabled().catch(() => false)); ready += 1) await page.waitForTimeout(250)
        if (!(await add.isEnabled().catch(() => false)) && currentResumeId) {
          trace('add-disabled-refresh')
          await page.goto(`https://hh.ru/profile/resume/experience?resume=${currentResumeId}`, {
            waitUntil: 'domcontentloaded', timeout: 120_000
          })
          await page.waitForTimeout(1500)
          add = await firstVisible([
            page.locator('button[data-qa="list-add"]:visible')
              .filter({ hasText: /^Добавить$|^Add$/i }),
            page.getByRole('button', { name: /^Добавить$|^Add$/i })
          ])
          for (let ready = 0; add && ready < 60 &&
            !(await add.isEnabled().catch(() => false)); ready += 1) await page.waitForTimeout(250)
          trace('add-after-refresh', { enabled: await add?.isEnabled().catch(() => false) })
        }
        if (!add) throw profileFillerError('profile_hh_experience_add_missing',
          'HH experience Add control disappeared after refreshing the step.', 'fill_resume')
        if (!(await add.isEnabled().catch(() => false))) throw profileFillerError(
          'profile_hh_experience_add_disabled',
          'HH experience Add control remained disabled.', 'fill_resume')
        await add.click()
        for (let settle = 0; settle < 20 && !itemSheet; settle += 1) {
          itemSheet = await page.locator('[data-qa="modal-edit-list-item-save"]:visible')
            .isVisible().catch(() => false)
          if (!itemSheet) await page.waitForTimeout(250)
        }
      }
      if (!itemSheet) throw profileFillerError('profile_hh_experience_editor_missing',
        'HH ignored the experience Add action after one retry.', 'fill_resume')
      trace('editor-opened')
      company = page.locator(
        '[data-qa*="resume-profile-experience-specific-company-input"]:visible').last()
    }
    if (!(await company.isVisible().catch(() => false))) throw profileFillerError(
      'profile_hh_experience_company_missing', 'HH experience company field was not found.',
      'fill_resume')
    const currentField = (token: string) => itemSheet
      ? page.locator(`[data-qa*="${token}"]:visible`).last()
      : wizard.locator(`[data-qa*="${token}"]:visible`).first()
    let position = currentField('resume-profile-experience-specific-position-input')
    let responsibilities = currentField('resume-profile-experience-specific-responsibilities-input')
    if (!(await company.isVisible().catch(() => false)) ||
        !(await position.isVisible().catch(() => false)) ||
        !(await responsibilities.isVisible().catch(() => false))) throw profileFillerError(
      'profile_hh_experience_fields_missing',
      'HH experience position or responsibilities field was not found.', 'fill_resume')

    // Opening the editor drops the resume query parameter and leaves the page
    // at /profile/resume/experience. Prefer the explicit draft ID; parsing that
    // route would otherwise mistake the word "experience" for a resume ID.
    const targetResumeId = currentResumeId || resumeId(page.url())
    await setExperienceResumePropagation(page, [targetResumeId])

    await company.fill(item.company)
    await page.waitForTimeout(400)
    const companySuggestions = page.locator('[data-qa="suggest-item-cell"]:visible')
    let companySuggestion: Locator | undefined
    for (let index = 0; index < await companySuggestions.count(); index += 1) {
      const candidate = companySuggestions.nth(index)
      if (normalizedExperienceText(await candidate.innerText()) ===
          normalizedExperienceText(item.company)) {
        companySuggestion = candidate
        break
      }
    }
    if (companySuggestion) await companySuggestion.click()
    else {
      await acceptExperienceFreeText(page, company, artifactDir)
      company = currentField('resume-profile-experience-specific-company-input')
      if (normalizedExperienceText(await company.inputValue().catch(() => '')) !==
          normalizedExperienceText(item.company)) throw profileFillerError(
        'profile_hh_experience_company_not_applied',
        'HH did not preserve the custom experience company after closing its editor.',
        'fill_resume')
    }
    position = currentField('resume-profile-experience-specific-position-input')
    await position.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
    if (!(await position.isVisible().catch(() => false))) throw profileFillerError(
      'profile_hh_experience_editor_closed',
      'HH closed the experience editor after accepting the company.', 'fill_resume')
    await position.fill(item.title)
    await position.blur()
    if (await closeExperienceTextEditor(page, /^(?:Должность|Position|Job title)$/i)) {
      position = currentField('resume-profile-experience-specific-position-input')
      await position.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
      if (normalizedExperienceText(await position.inputValue().catch(() => '')) !==
          normalizedExperienceText(item.title)) throw profileFillerError(
        'profile_hh_experience_position_not_applied',
        'HH did not preserve the experience position after closing its editor.', 'fill_resume')
    }
    responsibilities = currentField('resume-profile-experience-specific-responsibilities-input')
    await responsibilities.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
    if (!(await responsibilities.isVisible().catch(() => false))) throw profileFillerError(
      'profile_hh_experience_editor_closed',
      'HH closed the experience editor before responsibilities were filled.', 'fill_resume')
    await responsibilities.fill(item.description)
    if (await saveExperienceResponsibilitiesEditor(page)) {
      responsibilities = currentField('resume-profile-experience-specific-responsibilities-input')
      await responsibilities.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
    }
    // HH can mount the position editor late, after the responsibilities sheet
    // has closed. Close that exact editor before interacting with date fields.
    if (await closeExperienceTextEditor(page, /^(?:Должность|Position|Job title)$/i)) {
      position = currentField('resume-profile-experience-specific-position-input')
      await position.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
      if (normalizedExperienceText(await position.inputValue().catch(() => '')) !==
          normalizedExperienceText(item.title)) throw profileFillerError(
        'profile_hh_experience_position_not_applied',
        'HH did not preserve the experience position after closing its editor.', 'fill_resume')
    }

    const setMonth = async (kind: 'datestart' | 'dateend', month: string) => {
      let control = currentField(`resume-profile-experience-specific-${kind}-month-input`)
      if (!(await control.isVisible().catch(() => false))) {
        // The current HH editor gives the city, start-month and end-month
        // activators the same generic data-qa. Their order in the experience
        // form is stable and the year inputs still delimit the two dates.
        const generic = itemSheet
          ? page.locator('[data-qa="bottom-sheet-content"]:visible')
            .last().locator('[data-qa="magritte-select-activator-input"]:visible')
          : wizard.locator('[data-qa="magritte-select-activator-input"]:visible')
        control = generic.nth(kind === 'datestart' ? 1 : 2)
      }
      if (!(await control.isVisible().catch(() => false))) throw profileFillerError(
        'profile_hh_experience_month_missing',
        `HH experience ${kind} month control was not found.`, 'fill_resume')
      if (await dismissExperienceOverlayBlocking(page, control)) {
        if (itemSheet && !(await page.locator('[data-qa="modal-edit-list-item-save"]:visible')
          .isVisible().catch(() => false))) throw profileFillerError(
          'profile_hh_experience_editor_closed',
          'HH closed the experience editor while dismissing a nested date overlay.', 'fill_resume')
        position = currentField('resume-profile-experience-specific-position-input')
        if (normalizedExperienceText(await position.inputValue().catch(() => '')) !==
            normalizedExperienceText(item.title)) throw profileFillerError(
          'profile_hh_experience_position_not_applied',
          'HH did not preserve the experience position after dismissing its editor.', 'fill_resume')
      }
      await control.click({ timeout: 5000 }).catch(() => {
        throw profileFillerError('profile_hh_experience_month_blocked',
          `HH experience ${kind} month control remained blocked.`, 'fill_resume')
      })
      const option = page.locator(`[data-qa="magritte-select-option-${month}"]:visible`)
      await option.waitFor({ state: 'visible', timeout: 5000 })
      await option.click()
      await option.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
    }
    const [startMonth, startYear] = (item.startDate ?? '').split('/')
    if (startMonth && startYear) {
      await setMonth('datestart', startMonth.padStart(2, '0'))
      const startYearControl = currentField(
        'resume-profile-experience-specific-datestart-year-input')
      await startYearControl.fill(startYear)
      await startYearControl.press('Tab')
      await page.waitForTimeout(300)
    }
    const currentLabel = page.getByText(/^Работаю сейчас$|^Currently work here$/i).last()
    const currentCheckbox = currentLabel.locator('xpath=ancestor::label[1]')
      .locator('input[type="checkbox"]')
    const worksNow = await currentCheckbox.isChecked().catch(() => false)
    if (item.current) {
      if (!worksNow) await currentLabel.click()
    } else if (item.endDate) {
      // New HH workplace cards default to "currently work here". Explicitly
      // clear it before choosing the end date, otherwise the end-month picker
      // remains disabled and never opens.
      if (worksNow) {
        await currentLabel.click()
        await page.waitForTimeout(300)
      }
      const [endMonth, endYear] = item.endDate.split('/')
      if (endMonth && endYear) {
        await setMonth('dateend', endMonth.padStart(2, '0'))
        const endYearControl = currentField(
          'resume-profile-experience-specific-dateend-year-input')
        await endYearControl.fill(endYear)
        await endYearControl.press('Tab')
        await page.waitForTimeout(300)
      }
    }
    if (itemSheet) {
      const saveItem = page.locator('[data-qa="modal-edit-list-item-save"]:visible')
      company = currentField('resume-profile-experience-specific-company-input')
      if (normalizedExperienceText(await company.inputValue().catch(() => '')) !==
          normalizedExperienceText(item.company)) {
        await company.fill(item.company)
        await page.waitForTimeout(1200)
        const companyOptions = await page.locator(
          '[data-qa="suggest-item-cell"]:visible, [role="option"]:visible, [data-qa*="suggest"]:visible')
          .allTextContents().catch(() => [])
        trace('company-options', { options: companyOptions.map(value => value.trim()).filter(Boolean) })
        let exactCompany: Locator | undefined
        const exactCandidates = page.locator('[data-qa="suggest-item-cell"]:visible')
        for (let index = 0; index < await exactCandidates.count(); index += 1) {
          const candidate = exactCandidates.nth(index)
          if (normalizedExperienceText(await candidate.innerText()) ===
              normalizedExperienceText(item.company)) {
            exactCompany = candidate
            break
          }
        }
        if (exactCompany) {
          await exactCompany.click()
        } else {
          const companyHeading = await firstVisible([
            page.getByRole('heading', { name: /^(?:Название компании|Company name)$/i,
              exact: true }),
            page.getByText(/^(?:Название компании|Company name)$/i, { exact: true })
          ])
          if (!companyHeading) throw profileFillerError(
            'profile_hh_experience_company_suggestion_missing',
            `HH did not offer an exact company suggestion for "${item.company}".`, 'fill_resume')
          await acceptExperienceFreeText(page, company, artifactDir)
        }
        await page.waitForTimeout(300)
        await dismissExperienceOverlayBlocking(page, saveItem)
        company = currentField('resume-profile-experience-specific-company-input')
      }
      if (normalizedExperienceText(await company.inputValue().catch(() => '')) !==
          normalizedExperienceText(item.company)) throw profileFillerError(
        'profile_hh_experience_company_not_applied',
        'HH did not preserve the experience company in the workplace editor.', 'fill_resume')
      const fieldState = async () => await page.locator(
        '[data-qa*="resume-profile-experience-specific"]')
        .evaluateAll(elements => elements.map(element => ({
          qa: element.getAttribute('data-qa'),
          filled: Boolean(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.value : element.getAttribute('data-value')),
          invalid: element.getAttribute('aria-invalid'),
          disabled: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ||
            element instanceof HTMLButtonElement ? element.disabled : undefined
        })))
      const propagationState = async () => await page.locator(
        'input[type="checkbox"], [role="checkbox"]')
        .evaluateAll(elements => elements.map(element => {
          const input = element instanceof HTMLInputElement ? element : undefined
          return {
            qa: element.getAttribute('data-qa'), name: input?.name ?? '',
            value: input?.value ?? '', checked: input
              ? input.checked : element.getAttribute('aria-checked') === 'true',
            disabled: input ? input.disabled : element.getAttribute('aria-disabled') === 'true',
            label: String(element.closest('label')?.textContent ?? '').replace(/\s+/g, ' ').trim()
          }
        }))
      trace('before-save', { fields: await fieldState(),
        propagation: await propagationState() })
      if (!(await saveItem.isEnabled().catch(() => false))) throw profileFillerError(
        'profile_hh_experience_save_disabled',
        'HH experience Save control remained disabled after filling.', 'fill_resume')
      let closed = false
      for (let attempt = 0; attempt < 2 && !closed; attempt += 1) {
        const mutationResponses: Array<Promise<Record<string, unknown>>> = []
        const collectResponse = (response: import('playwright').Response) => {
          if (response.request().method() === 'GET') return
          mutationResponses.push((async () => ({
            method: response.request().method(), status: response.status(), path: new URL(response.url()).pathname
          }))())
        }
        page.on('response', collectResponse)
        const saveResponse = page.waitForResponse(response =>
          response.request().method() !== 'GET' &&
          /resume|profile|experience|workplace/i.test(response.url()), { timeout: 10_000 })
          .catch(() => undefined)
        await saveItem.click()
        const response = await saveResponse
        trace('save-response', response ? {
          attempt: attempt + 1, status: response.status(), path: new URL(response.url()).pathname
        } : { attempt: attempt + 1, missing: true })
        for (let settle = 0; settle < 20 && !closed; settle += 1) {
          closed = !(await saveItem.isVisible().catch(() => false))
          if (!closed) await page.waitForTimeout(250)
        }
        await page.waitForTimeout(1000)
        page.off('response', collectResponse)
        trace('save-responses', { attempt: attempt + 1,
          responses: await Promise.all(mutationResponses), propagation: await propagationState() })
        if (!closed) trace('save-rejected', {
          attempt: attempt + 1, fields: await fieldState(),
          errors: await page.locator('[role="alert"]:visible, [data-qa*="error"]:visible')
            .allTextContents().catch(() => [])
        })
      }
      if (!closed) throw profileFillerError('profile_hh_experience_save_not_applied',
        'HH kept the experience editor open after one Save retry.', 'fill_resume')
      trace('editor-closed')
      // HH closes the sheet before its asynchronous workplace write settles.
      // Navigating immediately can abort that request and silently lose the
      // card, so keep the page stable before re-reading the resume step.
      await page.waitForTimeout(2500)
      trace('cards-after-save', {
        cards: await page.locator('label[data-qa="cell"]:visible')
          .allTextContents().catch(() => [])
      })
      if (currentResumeId) {
        await page.goto(`https://hh.ru/profile/resume/experience?resume=${currentResumeId}`, {
          waitUntil: 'domcontentloaded', timeout: 120_000
        })
        await page.waitForTimeout(2500)
      }
      let persisted = await page.getByText(item.company, { exact: false })
        .isVisible().catch(() => false)
      if (!persisted) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
        await page.waitForTimeout(2500)
        persisted = await page.getByText(item.company, { exact: false })
          .isVisible().catch(() => false)
      }
      if (!persisted) {
        throw profileFillerError('profile_hh_experience_save_not_applied',
          `HH did not persist the experience entry for "${item.company}".`, 'fill_resume')
      }
      trace('entry-persisted')
    } else {
      const controls = await wizard.locator('input:visible, textarea:visible, button[data-qa="list-add"]:visible')
        .evaluateAll(elements => elements.map(element => {
          const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element : undefined
          const button = element instanceof HTMLButtonElement ? element : undefined
          return {
            qa: element.getAttribute('data-qa'), type: input?.type ?? '',
            filled: Boolean(input?.value.trim()), length: input?.value.length ?? 0,
            checked: input instanceof HTMLInputElement ? input.checked : undefined,
            disabled: input?.disabled ?? button?.disabled ?? false,
            dataValue: element.getAttribute('data-value')
          }
        }))
      trace('inline-filled', { controls })
    }
    return true
  }
  const clicked = await clickText(page, [/добавить место работы/i, /add experience/i, /add workplace/i])
  if (!clicked) return false
  await fill(page, item.company, ['Компания', 'Company'], ['input[name*="company"]'], true)
  await fill(page, item.title, ['Должность', 'Position', 'Job title'],
    ['input[name*="position"]', 'input[name*="title"]'], true)
  await fill(page, item.startDate, ['Начало работы', 'Start date'], ['input[name*="start"]'])
  if (!item.current) await fill(page, item.endDate, ['Окончание работы', 'End date'],
    ['input[name*="end"]'])
  await fill(page, item.location, ['Город', 'Location'], ['input[name*="location"]'])
  await fill(page, item.description, ['Обязанности', 'Responsibilities', 'Description'],
    ['textarea[name*="description"]'], true)
  await clickText(page, [/^сохранить$/i, /^save$/i], true)
  return true
}

async function addDraftExperienceThroughProfile(page: Page, item: CvExperience,
  draftId: string, artifactDir: string, publishedHostId?: string,
  targetResumeIds: string[] = [draftId]): Promise<boolean> {
  // The unfinished wizard keeps a newly added workplace only in its local
  // final-step state; persisting that state would advance and publish the
  // draft. Use an existing published resume as the safe profile-level editor
  // host and propagate the new workplace only to the requested draft IDs.
  if (publishedHostId && publishedHostId !== draftId) {
    await page.goto(`https://hh.ru/resume/${encodeURIComponent(publishedHostId)}/experience`, {
      waitUntil: 'domcontentloaded', timeout: 120_000
    })
    await page.waitForTimeout(1000)
    if (/\/resume\/[a-z0-9]+\/experience/i.test(new URL(page.url()).pathname)) {
      return await addExperience(page, item, draftId, artifactDir, targetResumeIds)
    }
  }

  await page.goto('https://hh.ru/profile/edit/experience', {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  await page.waitForTimeout(1000)
  return await addPublishedExperience(page, item, [], {
    editorAlreadyOpen: true, artifactDir
  })
}

async function closeEducationEditorSheet(page: Page): Promise<void> {
  const content = page.locator('[data-qa="bottom-sheet-content"]:visible').last()
  if (!(await content.isVisible().catch(() => false))) return
  const sheet = content.locator(
    'xpath=ancestor::*[@data-qa="bottom-sheet-css-variables"][1]')
  const close = await firstVisible([
    sheet.locator('[data-qa="select-bottom-sheet-navigation-close"]:visible'),
    sheet.locator('button[aria-label*="Закры"]:visible'),
    sheet.locator('button[aria-label*="Назад"]:visible')
  ])
  if (close) await close.click()
  if (await content.isVisible().catch(() => false)) {
    const backdrop = sheet.locator('[data-qa="bottom-sheet-overlay"]:visible')
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click({ position: { x: 5, y: 5 } }).catch(() => undefined)
    }
  }
  if (await content.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => undefined)
  }
  await content.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
  if (await content.isVisible().catch(() => false)) throw profileFillerError(
    'profile_hh_education_bottom_sheet_blocked',
    'HH education suggestion panel remained open.', 'fill_resume')
}

export async function findEducationUniversityInput(scope: Page | Locator): Promise<Locator | undefined> {
  return await firstVisible([
    scope.locator('[data-qa="profile-education-university-input"]'),
    scope.getByPlaceholder(/^(?:Название|Название учебного заведения)$/i),
    scope.getByPlaceholder(/^(?:Institution|University|School name)$/i),
    scope.getByLabel(/Название учебного заведения|Institution|University/i)
  ])
}

export async function acceptEducationFreeText(page: Page, input: Locator): Promise<void> {
  const sheet = input.locator('xpath=ancestor::*[@data-qa="bottom-sheet-content"][1]')
  if (!(await sheet.count().catch(() => 0))) {
    await input.press('Tab')
    return
  }
  await input.press('Enter')
  await sheet.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
  if (await sheet.isVisible().catch(() => false)) throw profileFillerError(
    'profile_hh_education_bottom_sheet_blocked',
    'HH education free-text editor remained open after confirmation.', 'fill_resume')
}

async function addEducation(page: Page, item: CvEducation, currentResumeId?: string) {
  const wizardScreen = page.locator('[data-qa*="resume-profile-screen_educations"]:visible')
  const profileSave = page.locator('[data-qa="profile-layout-save-button"]:visible')
  const profileEditor = await profileSave.isVisible().catch(() => false)
  const wizard = profileEditor ? page.locator('body') : wizardScreen
  if (profileEditor || await wizard.isVisible().catch(() => false)) {
    const level = await firstVisible([
      wizard.locator('[data-qa="profile-education-primary-level-select"]'),
      wizard.locator('[data-qa="magritte-select-activator"]')
    ])
    if (item.degree && level) {
      const normalizedDegree = item.degree.trim().toLowerCase()
      const levelCode = normalizedDegree.includes('магистр') || normalizedDegree.includes('master')
        ? 'master'
        : normalizedDegree.includes('бакалавр') || normalizedDegree.includes('bachelor')
          ? 'bachelor'
          : normalizedDegree.includes('кандидат') || normalizedDegree.includes('candidate')
            ? 'candidate'
            : normalizedDegree.includes('доктор') || normalizedDegree.includes('doctor')
              ? 'doctor'
              : normalizedDegree.includes('неокончен') || normalizedDegree.includes('unfinished')
                ? 'unfinished_higher'
                : normalizedDegree.includes('среднее специаль') || normalizedDegree.includes('vocational')
                  ? 'special_secondary'
                  : normalizedDegree.includes('среднее') || normalizedDegree.includes('secondary')
                    ? 'secondary'
                    : 'higher'
      const currentLevel = String(await level.getAttribute('data-value').catch(() => '') ||
        await level.innerText().catch(() => '')).trim().toLowerCase()
      const levelPatterns: Record<string, RegExp> = {
        master: /магистр|master/i, bachelor: /бакалавр|bachelor/i,
        candidate: /кандидат|candidate/i, doctor: /доктор|doctor/i,
        unfinished_higher: /неокончен|unfinished/i,
        special_secondary: /среднее специаль|vocational/i,
        secondary: /среднее|secondary/i, higher: /высшее|higher/i
      }
      if (!levelPatterns[levelCode].test(currentLevel)) {
        await level.click()
        const degree = await firstVisible([
          page.locator(`[data-qa="magritte-select-option-${levelCode}"]:visible`),
          page.locator('[role="option"]:visible').filter({ hasText: item.degree })
        ])
        if (!degree) throw profileFillerError('profile_hh_education_level_missing',
          `HH education level was not found for "${item.degree}".`, 'fill_resume')
        await degree.click()
        await closeEducationEditorSheet(page)
        await page.waitForTimeout(300)
      }
    }
    // HH checks other resumes by default. Disable propagation before opening the
    // university and specialty suggestion sheets; those sheets can otherwise
    // absorb checkbox clicks after text entry.
    const propagateNames = await wizard.locator('input[type="checkbox"][name]:checked')
      .evaluateAll(inputs => inputs.map(input => input.getAttribute('name')).filter(Boolean) as string[])
    for (const name of propagateNames.filter(name => name !== currentResumeId)) {
      const currentCheckbox = () => wizard.locator(`input[type="checkbox"][name="${name}"]`)
      const isChecked = async () => {
        const checkbox = currentCheckbox()
        if (!(await checkbox.count())) return false
        return await checkbox.isChecked({ timeout: 1000 }).catch(() => false)
      }
      for (let attempt = 0; attempt < 3 && await isChecked(); attempt += 1) {
        const label = currentCheckbox().locator('xpath=ancestor::label[1]')
        await label.click({ force: true })
        for (let settle = 0; settle < 10 && await isChecked(); settle += 1) {
          await page.waitForTimeout(100)
        }
      }
      if (await isChecked()) {
        throw profileFillerError('profile_hh_education_propagation_blocked',
          `HH did not disable education propagation to resume ${name}.`, 'fill_resume')
      }
    }
    if (profileEditor) {
      const attachedResumes = wizard.locator('input[type="checkbox"][aria-label]:checked')
      for (let index = await attachedResumes.count() - 1; index >= 0; index -= 1) {
        const checkbox = attachedResumes.nth(index)
        const label = checkbox.locator('xpath=ancestor::label[1]')
        await label.click()
      }
      if (await wizard.locator('input[type="checkbox"][aria-label]:checked').count()) {
        throw profileFillerError('profile_hh_education_propagation_blocked',
          'HH did not disable education propagation to existing resumes.', 'fill_resume')
      }
    }
    const directUniversity = await findEducationUniversityInput(wizard)
    const textareas = wizard.locator('textarea:visible')
    let universityInput = directUniversity
    if (!universityInput && await textareas.count() >= 1) {
      await textareas.nth(0).click()
      universityInput = await findEducationUniversityInput(page)
    }
    if (!universityInput) return false
    const currentInstitution = String(await universityInput.inputValue().catch(() => '')).trim()
    if (currentInstitution !== item.institution.trim()) {
      await universityInput.fill(item.institution)
      await page.waitForTimeout(700)
    }
    const escapedInstitution = item.institution.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (currentInstitution !== item.institution.trim()) {
      const universityOption = await firstVisible([
        page.locator('[data-qa="suggest-item-cell"]:visible')
          .filter({ hasText: new RegExp(escapedInstitution, 'i') }),
        page.getByText(item.institution, { exact: true }).last()
      ])
      // Some foreign institutions have no HH directory card under either the
      // source-language name or their Russian abbreviation. Preserve the exact
      // CV value as free text instead of selecting an unrelated suggestion.
      if (universityOption) {
        await universityOption.click()
        await page.waitForTimeout(300)
      } else {
        await acceptEducationFreeText(page, universityInput)
      }
      await closeEducationEditorSheet(page)
    }
    if (item.specialization) {
      let specialtyInput = await firstVisible([
        wizard.locator('[data-qa="profile-education-specialty-input"]'),
        wizard.getByPlaceholder(/^Специализация$/i),
        wizard.getByLabel(/Специализация|Field of study|Specialization/i)
      ])
      if (!specialtyInput && await textareas.count() >= 3) {
        await textareas.nth(2).click()
        specialtyInput = await firstVisible([
          page.locator('[data-qa="profile-education-specialty-input"]:visible')
        ])
      }
      if (!specialtyInput) throw profileFillerError('profile_hh_education_specialty_missing',
        'HH education specialization field was not found.', 'fill_resume')
      const currentSpecialization = String(await specialtyInput.inputValue().catch(() => '')).trim()
      if (currentSpecialization !== item.specialization.trim()) {
        await specialtyInput.fill(item.specialization)
        await page.waitForTimeout(700)
      }
      const escapedSpecialization = item.specialization.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const specialtyOptions = page.locator('[data-qa="suggest-item-cell"]:visible')
        .filter({ hasText: new RegExp(escapedSpecialization, 'i') })
      const prefersMaster = /магистр|master/i.test(item.degree ?? '')
      const specialtyOption = prefersMaster
        ? await firstVisible([specialtyOptions.filter({ hasText: /магистр|master/i }), specialtyOptions])
        : await firstVisible([specialtyOptions])
      if (specialtyOption) {
        await specialtyOption.click()
        await page.waitForTimeout(300)
      } else {
        await acceptEducationFreeText(page, specialtyInput)
      }
      await closeEducationEditorSheet(page)
    }
    const year = await firstVisible([
      wizard.locator('[data-qa="profile-education-year-input"]'),
      wizard.locator('[data-qa="primary-education-form-year-input"]'),
      wizard.getByPlaceholder(/Год окончания|Graduation year/i),
      wizard.getByLabel(/Год окончания|Graduation year/i)
    ])
    if (item.graduationYear && year && await year.isVisible().catch(() => false)) {
      const expectedYear = String(item.graduationYear)
      if (String(await year.inputValue().catch(() => '')).trim() !== expectedYear) {
        await year.fill(expectedYear)
      }
    }
    if (profileEditor) {
      await page.waitForTimeout(300)
      await closeEducationEditorSheet(page)
      // A directory suggestion can close its sheet while clearing the value.
      // Re-read the persisted form control and confirm the exact CV text before saving.
      if (await textareas.count() &&
          (await textareas.first().inputValue()).trim() !== item.institution.trim()) {
        await textareas.first().click()
        const input = await findEducationUniversityInput(page)
        if (!input) throw profileFillerError('profile_hh_education_control_missing',
          'HH university editor was not found before saving.', 'fill_resume')
        await input.fill(item.institution)
        await page.waitForTimeout(700)
        await acceptEducationFreeText(page, input)
        if ((await textareas.first().inputValue()).trim() !== item.institution.trim()) {
          throw profileFillerError('profile_hh_education_not_persisted',
            'HH did not retain the CV university name before saving.', 'fill_resume')
        }
      }
      await profileSave.click()
      await page.waitForURL(url => /\/profile\/block\/educations/i.test(url.pathname), {
        timeout: 15_000
      }).catch(() => undefined)
      if (!/\/profile\/block\/educations/i.test(new URL(page.url()).pathname) ||
          !(await page.getByText(item.institution, { exact: false }).first().isVisible().catch(() => false))) {
        throw profileFillerError('profile_hh_education_not_persisted',
          `HH did not persist education for "${item.institution}".`, 'verify_draft')
      }
    }
    return true
  }
  const clicked = await clickText(page, [/добавить образование/i, /add education/i])
  if (!clicked) return false
  await fill(page, item.institution, ['Учебное заведение', 'Institution', 'University'],
    ['input[name*="organization"]', 'input[name*="institution"]'], true)
  await fill(page, item.specialization, ['Специализация', 'Field of study', 'Specialization'],
    ['input[name*="specialization"]'])
  await fill(page, item.degree, ['Степень', 'Degree'], ['input[name*="degree"]'])
  await fill(page, item.graduationYear ? String(item.graduationYear) : undefined,
    ['Год окончания', 'Graduation year'], ['input[name*="year"]'])
  await clickText(page, [/^сохранить$/i, /^save$/i], true)
  return true
}

function normalizedEducationText(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ').trim()
}

function normalizedExperienceText(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

function experienceCardMatches(text: string, item: CvExperience): boolean {
  const card = normalizedExperienceText(text)
  const lines = text.split(/\r?\n/).map(normalizedExperienceText).filter(Boolean)
  const company = normalizedExperienceText(item.company)
  const title = normalizedExperienceText(item.title)
  // Company names are reliable substrings of a complete HH card. Titles are
  // not: "Backend-разработчик" is also a substring of "Python
  // Backend-разработчик" and would make a different workplace look present.
  // Keep the title-only fallback for compact HH cards, but require a whole
  // rendered line to match.
  return Boolean((company && card.includes(company)) ||
    (title && lines.some(line => line === title)))
}

function educationCardMatches(text: string, item: CvEducation): boolean {
  return normalizedEducationText(text).includes(normalizedEducationText(item.institution)) &&
    (!item.graduationYear || new RegExp(`\\b${item.graduationYear}\\b`).test(text))
}

async function findExperienceCardBySignature(screen: Locator,
  signature: string): Promise<Locator | undefined> {
  const cards = screen.locator('label[data-qa="cell"]:visible')
  for (let index = 0; index < await cards.count(); index += 1) {
    const card = cards.nth(index)
    if (normalizedExperienceText(await card.innerText()) === signature) return card
  }
  return undefined
}

async function waitForExperienceSelection(screen: Locator, signature: string,
  expected: boolean): Promise<boolean> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const card = await findExperienceCardBySignature(screen, signature)
    const checkbox = card?.locator('input[type="checkbox"]').first()
    if (checkbox && await checkbox.count() &&
        await checkbox.isChecked().catch(() => undefined) === expected) return true
    await screen.page().waitForTimeout(200)
  }
  return false
}

async function hasResumeExperienceCard(page: Page, item: CvExperience): Promise<boolean> {
  const cards = page.locator(
    '[data-qa*="resume-profile-screen_experience"]:visible label[data-qa="cell"]:visible')
  for (let index = 0; index < await cards.count(); index += 1) {
    if (experienceCardMatches(await cards.nth(index).innerText(), item)) return true
  }
  return false
}

export async function syncResumeExperienceSelection(page: Page,
  items: CvExperience[], verifyOnly = false): Promise<boolean> {
  const screen = page.locator('[data-qa*="resume-profile-screen_experience"]:visible')
  if (verifyOnly) await screen.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
  if (!(await screen.isVisible().catch(() => false))) return false
  const cards = screen.locator('label[data-qa="cell"]:visible')
  if (verifyOnly && items.length) {
    await cards.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
  }
  if (!(await cards.count())) return false

  const matched = new Set<number>()
  const snapshots: Array<{ signature: string, wantedIndex: number }> = []
  for (let index = 0; index < await cards.count(); index += 1) {
    const text = await cards.nth(index).innerText()
    const wantedIndex = items.findIndex(item => experienceCardMatches(text, item))
    if (wantedIndex >= 0) matched.add(wantedIndex)
    snapshots.push({ signature: normalizedExperienceText(text), wantedIndex })
  }
  for (const { signature, wantedIndex } of snapshots) {
    // Existing profile experience outside the final CV is not destructive scope for
    // resume recovery. Keep it unchanged and only require the CV entries to be selected.
    if (wantedIndex < 0) continue
    const shouldBeChecked = wantedIndex >= 0
    const card = await findExperienceCardBySignature(screen, signature)
    if (!card) throw profileFillerError('profile_hh_experience_selection_missing',
      'HH experience card disappeared before its selection could be verified.', 'fill_resume')
    const checkbox = card.locator('input[type="checkbox"]').first()
    if (!(await checkbox.count())) throw profileFillerError(
      'profile_hh_experience_selection_missing',
      'HH experience card does not expose its selection control.', 'fill_resume')
    const checked = await checkbox.isChecked().catch(() => false)
    if (!verifyOnly && checked !== shouldBeChecked) {
      await checkbox.click()
    }
    if (!(await waitForExperienceSelection(screen, signature, shouldBeChecked))) {
      const currentCard = await findExperienceCardBySignature(screen, signature)
      const actual = currentCard ? await currentCard.locator('input[type="checkbox"]').first()
        .isChecked().catch(() => undefined) : undefined
      throw profileFillerError('profile_hh_experience_not_selected',
        `HH did not retain the required experience selection for "${signature}" ` +
        `(expected ${shouldBeChecked}, received ${String(actual)}).`, 'fill_resume')
    }
  }
  if (matched.size !== items.length) throw profileFillerError(
    'profile_hh_experience_not_found',
    'HH profile does not contain every experience entry required by the CV.', 'fill_resume')
  return true
}

export async function syncResumeEducationSelection(page: Page,
  items: CvEducation[], verifyOnly = false): Promise<boolean> {
  const screen = page.locator('[data-qa*="resume-profile-screen_educations"]:visible')
  if (!(await screen.isVisible().catch(() => false))) return false
  const cards = screen.locator('label[data-qa="cell"]:visible')
  if (!(await cards.count())) return false

  const matched = new Set<number>()
  for (let index = 0; index < await cards.count(); index += 1) {
    const card = cards.nth(index)
    const text = normalizedEducationText(await card.innerText())
    const wantedIndex = items.findIndex((item, i) => !matched.has(i) && educationCardMatches(text, item))
    const shouldBeChecked = wantedIndex >= 0
    if (shouldBeChecked) matched.add(wantedIndex)
    const checkbox = card.locator('input[type="checkbox"]').first()
    if (!(await checkbox.count())) throw profileFillerError(
      'profile_hh_education_selection_missing',
      'HH education card does not expose its selection control.', 'fill_resume')
    if (wantedIndex < 0) continue
    if (!verifyOnly && await checkbox.isChecked().catch(() => false) !== shouldBeChecked) await card.click()
    if (await checkbox.isChecked().catch(() => false) !== shouldBeChecked) {
      throw profileFillerError('profile_hh_education_not_selected',
        'HH did not retain the required education selection.', 'fill_resume')
    }
  }
  if (matched.size !== items.length) throw profileFillerError(
    'profile_hh_education_not_found',
    'HH profile does not contain every education entry required by the CV.', 'fill_resume')
  return true
}

const LANGUAGE_HEADING = /^(?:Языки|Languages)$/i
const LANGUAGE_EDIT = /^(?:Редактировать|Edit)$/i
const LANGUAGE_ADD = /^\+?\s*(?:Добавить|Add)$/i
const LANGUAGE_LEVEL = /\b[ABC][12]\b|Родной|Native/i

async function languageSection(page: Page): Promise<Locator | undefined> {
  const headings = [page.getByRole('heading', { name: LANGUAGE_HEADING }),
    page.getByText(LANGUAGE_HEADING, { exact: true })]
  const heading = await firstVisible(headings)
  if (!heading) return undefined
  const section = heading.locator(
    'xpath=ancestor-or-self::*[self::section or self::main or self::div]' +
    '[.//*[self::button or self::a][contains(normalize-space(.), "Добавить")' +
    ' or normalize-space(.)="Add" or normalize-space(.)="+ Add"]][1]')
  return await firstVisible([section])
}

async function languageAddControl(page: Page): Promise<Locator | undefined> {
  const section = await languageSection(page)
  if (!section) return undefined
  return await firstVisible([
    section.locator('[data-qa="profile-language-add"]:visible'),
    section.getByRole('button', { name: LANGUAGE_ADD }),
    section.getByRole('link', { name: LANGUAGE_ADD }),
    section.getByText(LANGUAGE_ADD, { exact: true })
  ])
}

async function openLanguageEditor(page: Page): Promise<void> {
  if (await languageAddControl(page)) return
  const heading = await firstVisible([page.getByRole('heading', { name: LANGUAGE_HEADING }),
    page.getByText(LANGUAGE_HEADING)])
  if (!heading) throw profileFillerError('profile_hh_language_editor_missing',
    'HH language section heading was not found.', 'fill_resume')
  const section = heading.locator(
    'xpath=ancestor::*[self::section or self::main or self::div]' +
    '[.//*[self::button or self::a][normalize-space(.)="Редактировать"' +
    ' or normalize-space(.)="Edit"]][1]')
  const edit = await firstVisible([
    section.getByRole('button', { name: LANGUAGE_EDIT }),
    section.getByRole('link', { name: LANGUAGE_EDIT }),
    section.getByText(LANGUAGE_EDIT)
  ])
  if (!edit) throw profileFillerError('profile_hh_language_editor_missing',
    'HH language section edit control was not found.', 'fill_resume')
  await edit.click()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await languageAddControl(page)) return
    await page.waitForTimeout(250)
  }
  throw profileFillerError('profile_hh_language_editor_missing',
    'HH language editor did not open.', 'fill_resume')
}

async function languageForm(page: Page, attempt = 0): Promise<Locator | undefined> {
  const sheets = page.locator('[data-qa="bottom-sheet-content"]:visible')
  for (let index = await sheets.count() - 1; index >= 0; index -= 1) {
    const sheet = sheets.nth(index)
    const hasControls = await sheet.getByRole('combobox').count() >= 2 ||
      await sheet.locator('input[name*="language"], input[name*="level"]').count() >= 2
    if (hasControls &&
        await sheet.getByRole('button', { name: /^(?:Сохранить|Save)$/i }).count()) return sheet
  }
  const save = await firstVisible([page.locator('[data-qa="profile-layout-save-button"]:visible')])
  if (save) {
    const ancestors = save.locator('xpath=ancestor::*[self::div or self::section]')
    for (let index = (await ancestors.count().catch(() => 0)) - 1; index >= 0; index -= 1) {
      const owner = ancestors.nth(index)
      if (await owner.getByRole('combobox').count() >= 2 ||
          await owner.locator('input[name*="language"], input[name*="level"]').count() >= 2) {
        return owner
      }
    }
  }
  const heading = await firstVisible([page.getByRole('heading', { name: /^(?:Язык|Language)$/i }),
    page.getByText(/^(?:Язык|Language)$/i)])
  if (heading) {
    const owner = heading.locator(
      'xpath=ancestor::*[(.//button[@role="combobox"] or .//input) and ' +
      './/button[normalize-space(.)="Сохранить" or normalize-space(.)="Save"]][1]')
    if (await owner.count().catch(() => 0)) return owner
  }
  if (attempt >= 20) return undefined
  await page.waitForTimeout(100)
  return await languageForm(page, attempt + 1)
}

async function languageOptionSheet(page: Page, form: Locator,
  kind: 'language' | 'level', value: string): Promise<Locator | undefined> {
  const sheets = page.locator(
    '[data-qa="bottom-sheet-content"]:visible, [data-qa="bottom-sheet-css-variables"]:visible')
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const valuePattern = kind === 'language'
    ? new RegExp(`^\\s*${escapedValue}\\s*$`, 'i')
    : new RegExp(`^\\s*${escapedValue}(?:\\s*(?:—|-).*)?\\s*$`, 'i')
  for (let index = await sheets.count() - 1; index >= 0; index -= 1) {
    const sheet = sheets.nth(index)
    if (await sheet.getByText(valuePattern).count()) return sheet
  }
  for (let index = await sheets.count() - 1; index >= 0; index -= 1) {
    const sheet = sheets.nth(index)
    if (await sheet.getByRole('option').count() || await sheet.getByRole('radio').count() ||
        await sheet.getByRole('textbox').count() || await sheet.getByRole('searchbox').count() ||
        await sheet.locator('input:visible').count()) return sheet
  }
  if (await form.getByRole('option').count() || await form.getByRole('radio').count() ||
      await form.getByRole('textbox').count() || await form.getByRole('searchbox').count() ||
      await form.locator('input:visible').count()) return form

  // The current level selector is a second portal without option/radio roles.
  // Anchor it by its own heading and nearest input-bearing panel instead of
  // widening the lookup to the document or the footer language switch.
  const headingPattern = kind === 'language'
    ? /^(?:Язык|Language)$/i
    : /^(?:Уровень владения|Proficiency level)$/i
  const heading = await firstVisible([
    page.getByRole('heading', { name: headingPattern }),
    page.getByText(headingPattern, { exact: true })
  ])
  if (heading) {
    const owner = heading.locator('xpath=ancestor-or-self::*[.//input][1]')
    if (await owner.isVisible().catch(() => false)) return owner
  }
  return undefined
}

async function visibleLanguageLevelRow(page: Page, value: string): Promise<Locator | undefined> {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rowText = new RegExp(`^\\s*${escaped}(?:\\s|[-–—]|$)`, 'i')
  const groups = [
    page.locator('button:visible, label:visible, [role="radio"]:visible, [data-qa="cell"]:visible')
      .filter({ hasText: rowText }),
    page.locator('div:visible').filter({ hasText: rowText })
  ]
  for (const group of groups) {
    for (let index = 0; index < await group.count(); index += 1) {
      const candidate = group.nth(index)
      const text = String(await candidate.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      if (text.length <= 120 && rowText.test(text)) return candidate
    }
  }
  return undefined
}

async function visibleLanguageOptionRow(page: Page, value: string): Promise<Locator | undefined> {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const exact = new RegExp(`^\\s*${escaped}\\s*$`, 'i')
  const groups = [
    page.getByRole('option', { name: exact }),
    page.getByRole('radio', { name: exact }),
    page.locator('button:visible, label:visible, [role="option"]:visible, ' +
      '[role="radio"]:visible, [data-qa="cell"]:visible').filter({ hasText: exact }),
    page.getByText(exact)
  ]
  for (const group of groups) {
    for (let index = 0; index < await group.count(); index += 1) {
      const candidate = group.nth(index)
      if (!(await candidate.isVisible().catch(() => false))) continue
      const text = String(await candidate.innerText().catch(() => ''))
        .replace(/\s+/g, ' ').trim()
      if (text.length <= 120 && exact.test(text)) return candidate
    }
  }
  return undefined
}

async function selectLanguageFormValue(page: Page, value: string,
  kind: 'language' | 'level'): Promise<void> {
  const selectionValue = kind === 'language' ? hhLanguageUiName(value) : value
  const form = await languageForm(page)
  if (!form) throw profileFillerError('profile_hh_language_dropdown_missing',
    'HH language modal was not found.', 'fill_resume')
  const label = kind === 'language'
    ? /^(?:Язык|Language)$/i
    : /^(?:Уровень(?: владения)?|Level|Proficiency)$/i
  const comboboxes = form.getByRole('combobox')
  const combobox = await firstVisible([
    comboboxes.filter({ hasText: label }),
    comboboxes.nth(kind === 'language' ? 0 : 1)
  ])
  if (!combobox) throw profileFillerError('profile_hh_language_dropdown_missing',
    `HH language ${kind} dropdown was not found.`, 'fill_resume')
  await combobox.click()
  await page.waitForTimeout(200)
  const optionSheet = await languageOptionSheet(page, form, kind, selectionValue)
  if (!optionSheet) throw profileFillerError('profile_hh_language_dropdown_missing',
    `HH language ${kind} option list did not open.`, 'fill_resume')
  if (kind === 'language') {
    const search = await firstVisible([
      optionSheet.getByRole('textbox'),
      optionSheet.getByRole('searchbox'),
      optionSheet.locator('input[type="search"]:visible'),
      optionSheet.locator('input:visible')
    ])
    if (!search) throw profileFillerError('profile_hh_language_search_missing',
      'HH language dropdown search field was not found.', 'fill_resume')
    await search.fill(selectionValue)
  }
  await page.waitForTimeout(300)
  const escaped = selectionValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const exact = new RegExp(`^\\s*${escaped}\\s*$`, 'i')
  const containing = kind === 'level'
    ? new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, 'i')
    : exact
  const optionName = kind === 'level'
    ? new RegExp(`^\\s*${escaped}(?:\\s*(?:—|-).*)?\\s*$`, 'i')
    : exact
  let option = await firstVisible([
    optionSheet.getByRole('option', { name: optionName }),
    optionSheet.getByRole('radio', { name: optionName }),
    optionSheet.locator('[data-qa*="suggest"]:visible').getByText(exact),
    optionSheet.locator('[data-qa*="select-option"]:visible').filter({ hasText: containing }),
    optionSheet.getByText(optionName)
  ])
  // HH portals the current level rows beside the base modal. The observed rows
  // are compact clickable blocks with no option/radio role, so resolve the
  // exact CEFR prefix only after the level panel itself has been detected.
  if (!option && kind === 'level') option = await visibleLanguageLevelRow(page, selectionValue)
  // Language search results can be portalled beside the search container and
  // rendered as a plain row with no option/radio role. At this point the
  // language selector is known to be open, so an exact visible UI name is safe.
  if (!option && kind === 'language') option = await visibleLanguageOptionRow(page, selectionValue)
  if (!option) throw profileFillerError(kind === 'language'
    ? 'profile_hh_language_option_missing'
    : 'profile_hh_language_level_missing',
  `HH language editor option was not found: ${value}.`, 'fill_resume')
  await option.click()
}

async function saveLanguageForm(page: Page, item: CvLanguage,
  includeName: boolean): Promise<void> {
  if (includeName) await selectLanguageFormValue(page, item.name, 'language')
  await selectLanguageFormValue(page, item.level, 'level')
  const form = await languageForm(page)
  if (!form) throw profileFillerError('profile_hh_language_dropdown_missing',
    'HH language modal disappeared before saving.', 'fill_resume')
  const save = await firstVisible([
    form.locator('[data-qa="profile-layout-save-button"]:visible'),
    form.getByRole('button', { name: /^(?:Сохранить|Save)$/i })
  ])
  if (!save) throw profileFillerError('profile_hh_language_dropdown_missing',
    'HH language save control was not found.', 'fill_resume')
  await save.click()
  await form.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
  if (await form.isVisible().catch(() => false)) throw profileFillerError(
    'profile_hh_language_not_persisted',
    `HH did not close the language editor after saving ${item.name}.`, 'verify_draft')
}

async function addLanguage(page: Page, item: CvLanguage): Promise<void> {
  const add = await languageAddControl(page)
  if (!add) throw profileFillerError('profile_hh_language_section_missing',
    'HH add-language control was not found.', 'fill_resume')
  await add.click()
  await saveLanguageForm(page, item, true)
}

function profileLanguagePatterns(item: CvLanguage): { name: RegExp; level: RegExp } {
  const normalizedName = item.name.trim().toLocaleLowerCase('en-US')
  const normalizedLevel = item.level.trim().toLocaleLowerCase('en-US')
  const name = /^(?:english|английский)$/.test(normalizedName)
    ? /английск|english/i
    : /^(?:russian|русский)$/.test(normalizedName)
      ? /русск|russian/i
      : new RegExp(item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const cefr = normalizedLevel.match(/\b([abc][12])\b/i)?.[1]
  const level = /native|родной/.test(normalizedLevel)
    ? /родной|native/i
    : cefr
      ? new RegExp(`\\b${cefr}\\b`, 'i')
      : new RegExp(item.level.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  return { name, level }
}

async function profileLanguageCard(page: Page, item: CvLanguage): Promise<Locator | undefined> {
  const section = await languageSection(page)
  if (!section) return undefined
  const { name, level } = profileLanguagePatterns(item)
  const stableRows = section.locator('[data-qa^="profile-language-card-row-"]:visible')
  for (let index = 0; index < await stableRows.count(); index += 1) {
    const row = stableRows.nth(index)
    if (name.test(String(await row.innerText().catch(() => '')))) return row
  }

  const names = section.getByText(name, { exact: true })
  for (let index = 0; index < await names.count(); index += 1) {
    const candidate = names.nth(index)
    if (!(await candidate.isVisible().catch(() => false))) continue
    const ancestors = candidate.locator('xpath=ancestor-or-self::*' +
      '[self::article or self::li or self::button or self::a or @role="button" or self::div]')
    for (let ownerIndex = (await ancestors.count()) - 1; ownerIndex >= 0; ownerIndex -= 1) {
      const owner = ancestors.nth(ownerIndex)
      const text = String(await owner.innerText().catch(() => '')).trim()
      if (!text || text.length > 300 || LANGUAGE_ADD.test(text) || !name.test(text)) continue
      if (LANGUAGE_LEVEL.test(text)) return owner
    }
  }
  return undefined
}

async function hasProfileLanguage(page: Page, item: CvLanguage): Promise<boolean> {
  const card = await profileLanguageCard(page, item)
  if (!card) return false
  return profileLanguagePatterns(item).level.test(
    String(await card.innerText().catch(() => '')).trim())
}

async function updateLanguage(page: Page, card: Locator, item: CvLanguage): Promise<void> {
  if (!(await card.isVisible().catch(() => false))) throw profileFillerError(
    'profile_hh_language_card_missing',
    `HH language card was not found for ${item.name}.`, 'fill_resume')
  await card.click()
  if (!(await languageForm(page))) throw profileFillerError('profile_hh_language_card_missing',
    `HH language card did not open for ${item.name}.`, 'fill_resume')
  await saveLanguageForm(page, item, false)
}

export async function syncProfileLanguages(page: Page, items: CvLanguage[]): Promise<void> {
  await openLanguageEditor(page)
  for (const item of items) {
    if (await hasProfileLanguage(page, item)) continue
    const existing = await profileLanguageCard(page, item)
    if (existing) await updateLanguage(page, existing, item)
    else await addLanguage(page, item)
    await openLanguageEditor(page)
    if (!(await hasProfileLanguage(page, item))) throw profileFillerError(
      'profile_hh_language_not_persisted',
      `HH did not persist language and level: ${item.name} ${item.level}.`, 'verify_draft')
  }
}

const HH_SKILL_LIMIT = 30

function normalizedSkill(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '')
}

const SKILL_ALIASES: Record<string, string[]> = {
  postgresql: ['PostgreSQL', 'Postgres'],
  postgres: ['PostgreSQL', 'Postgres'],
  apachekafka: ['Apache Kafka', 'Kafka'],
  kafka: ['Apache Kafka', 'Kafka'],
  awseks: ['AWS EKS', 'Amazon EKS'],
  awss3: ['AWS S3', 'Amazon S3'],
  gitlabcicd: ['GitLab CI/CD', 'GitLab CI'],
  gitlabci: ['GitLab CI/CD', 'GitLab CI'],
  googlecloudplatformgcp: ['Google Cloud Platform', 'GCP'],
  mcpmodelcontextprotocol: ['MCP (Model Context Protocol)', 'MCP'],
  mcp: ['MCP (Model Context Protocol)', 'MCP'],
  restapi: ['REST API', 'REST'],
  rest: ['REST API', 'REST'],
  grpc: ['gRPC', 'GRPC'],
  protobuf: ['Protobuf', 'Protocol Buffers'],
  websockets: ['WebSockets', 'WebSocket'],
  argocd: ['ArgoCD', 'Argo CD'],
  elkstack: ['ELK Stack', 'ELK'],
  oauth2: ['OAuth2', 'OAuth 2.0'],
  cleanarchitecture: ['Clean Architecture', 'Чистая архитектура'],
  eventdrivenархитектура: ['Event-driven architecture', 'Событийная архитектура'],
  микросервисы: ['Микросервисы', 'Микросервисная архитектура', 'Microservices'],
  стратегиикеширования: ['Кэширование', 'Caching'],
  agilescrumkanban: ['Agile', 'Scrum', 'Kanban']
}

export function skillSearchVariants(skill: string): string[] {
  return [...new Set([skill, ...(SKILL_ALIASES[normalizedSkill(skill)] ?? [])])]
}

export function sameSkill(left: string, right: string): boolean {
  const leftVariants = new Set(skillSearchVariants(left).map(normalizedSkill))
  return skillSearchVariants(right).some(value => leftVariants.has(normalizedSkill(value)))
}

async function selectedSkillNames(scope: Locator): Promise<string[]> {
  return (await scope.locator('[data-qa^="chips-trigger-chip-"]:visible').allInnerTexts())
    .map(value => value.trim()).filter(Boolean)
}

async function exactSkillOption(locator: Locator, variants: string[]): Promise<Locator | undefined> {
  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = locator.filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`, 'i') }).first()
    if (await match.isVisible().catch(() => false)) return match
  }
  return undefined
}

async function clickExactSkillOption(page: Page, locator: Locator,
  variants: string[]): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const option = await exactSkillOption(locator, variants)
    if (!option) return false
    if (await option.click({ timeout: 4000 }).then(() => true).catch(() => false)) return true
    await page.waitForTimeout(250)
  }
  return false
}

async function fillSkillSearch(page: Page, trigger: Locator, query: string): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let search = page.locator('[data-qa="chips-input-suggest-search"]:visible').last()
    if (!(await search.isVisible().catch(() => false))) {
      await trigger.click({ timeout: 4000 }).catch(() => undefined)
      search = page.locator('[data-qa="chips-input-suggest-search"]:visible').last()
      await search.waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined)
    }
    if (!(await search.isVisible().catch(() => false))) return false
    if (await search.fill(query, { timeout: 4000 }).then(() => true).catch(() => false)) {
      return true
    }
    await page.waitForTimeout(250)
  }
  return false
}

export async function addSkills(page: Page, skills: string[]) {
  const wizard = page.locator('[data-qa*="resume-profile-screen_keyskills"]:visible')
  if (await wizard.isVisible().catch(() => false)) {
    // The container's centre can be an existing tag's delete button.
    // Always click the actual input when HH exposes it.
    const skillInput = wizard.locator('[data-qa="chips-trigger-input"]:visible')
    const trigger = await skillInput.isVisible().catch(() => false)
      ? skillInput : wizard.locator('[data-qa="chips-input-suggest-trigger"]:visible')
    if (!(await trigger.isVisible().catch(() => false)) && skills.length) {
      throw profileFillerError('profile_hh_skills_control_missing',
        'HH skills search control was not found.', 'fill_resume')
    }
    let selected = await selectedSkillNames(wizard)
    for (const skill of skills) {
      if (selected.length >= HH_SKILL_LIMIT) break
      const variants = skillSearchVariants(skill)
      if (selected.some(current => variants.some(variant => sameSkill(current, variant)))) continue
      const before = selected.length
      if (await clickExactSkillOption(page,
        wizard.locator('[data-qa="suggest-item-chips"]:visible'), variants)) {
        await page.waitForTimeout(300)
        selected = await selectedSkillNames(wizard)
        if (selected.length > before) continue
      }
      let selectedOption = false
      for (const query of variants) {
        if (!(await fillSkillSearch(page, trigger, query))) {
          await page.keyboard.press('Escape').catch(() => undefined)
          return selected.length
        }
        // HH debounces this search; 400 ms still exposes the previous query's options.
        await page.waitForTimeout(1200)
        selectedOption = await clickExactSkillOption(page,
          page.locator('[data-qa="suggest-item-chips"]:visible'), variants)
        if (selectedOption) break
      }
      if (!selectedOption) {
        await page.keyboard.press('Escape').catch(() => undefined)
        continue
      }
      await page.waitForTimeout(300)
      selected = await selectedSkillNames(wizard)
    }
    if (await page.locator('[data-qa="bottom-sheet-overlay"]:visible').isVisible().catch(() => false)) {
      await page.keyboard.press('Escape').catch(() => undefined)
      await page.waitForTimeout(300)
    }
    return selected.length
  }
  const input = await field(page, ['Навык', 'Skill'], [
    '[data-qa*="skills"] input', 'input[name*="skill"]'
  ])
  if (!input && skills.length) {
    const screen = await page.locator('[data-qa*="resume-profile-screen"]:visible').first()
      .getAttribute('data-qa').catch(() => undefined)
    throw profileFillerError('profile_hh_skills_control_missing',
      `HH skills control was not found at ${page.url()}${screen ? ` (${screen})` : ''}.`,
      'fill_resume')
  }
  if (!input) return 0
  let added = 0
  for (const skill of skills) {
    await input.fill(skill)
    await page.waitForTimeout(250)
    const option = await firstVisible([page.locator('[role="option"]').filter({ hasText: skill }),
      page.getByText(skill, { exact: true })])
    if (!option) continue
    await option.click()
    added += 1
  }
  return added
}

async function fillDirectSkillsEditor(page: Page, skills: string[]): Promise<string[]> {
  const editor = page.locator('[data-qa="resume-editor-skills-input"]:visible')
  if (!(await editor.isVisible().catch(() => false))) throw profileFillerError(
    'profile_hh_skills_control_missing',
    `HH direct skills editor was not found at ${page.url()}.`, 'fill_resume')

  let selected = await selectedSkillNames(editor)
  for (const skill of skills) {
    if (selected.length >= HH_SKILL_LIMIT) break
    const variants = skillSearchVariants(skill)
    if (selected.some(current => variants.some(variant => sameSkill(current, variant)))) continue

    if (await clickExactSkillOption(page,
      page.locator('[data-qa^="resume-editor-skills-recommended-"]:visible'), variants)) {
      await page.waitForTimeout(150)
      selected = await selectedSkillNames(editor)
      continue
    }

    let selectedOption = false
    for (const query of variants) {
      if (!(await fillSkillSearch(page,
        page.locator('[data-qa="chips-trigger-input"]:visible'), query))) {
        await page.keyboard.press('Escape').catch(() => undefined)
        return selected
      }
      await page.waitForTimeout(1200)
      selectedOption = await clickExactSkillOption(page,
        page.locator('[data-qa="suggest-item-chips"]:visible'), variants)
      if (selectedOption) break
    }
    if (!selectedOption) {
      await page.keyboard.press('Escape').catch(() => undefined)
      continue
    }
    await page.waitForTimeout(150)
    selected = await selectedSkillNames(editor)
  }
  await page.keyboard.press('Escape').catch(() => undefined)
  return selected
}

async function setAllSkillsAdvanced(page: Page, skills: string[]) {
  const wizard = page.locator('[data-qa*="resume-profile-screen_skill_levels"]:visible')
  if (await wizard.isVisible().catch(() => false)) {
    const rows = wizard.locator('[data-qa="skill"]:visible')
    for (let index = 0; index < await rows.count(); index += 1) {
      const advanced = rows.nth(index).locator('[data-qa="skill-level-3"]:visible')
      if (!(await advanced.isVisible().catch(() => false))) {
        const skillName = await rows.nth(index).locator('[data-qa="skillName"]').innerText().catch(() => '')
        throw profileFillerError('profile_hh_skill_level_missing',
          `Advanced level control was not found for skill "${skillName}".`, 'fill_resume')
      }
      const selected = await advanced.getAttribute('aria-checked') === 'true' ||
        await advanced.getAttribute('aria-selected') === 'true' ||
        await advanced.isChecked().catch(() => false)
      if (!selected) await advanced.click()
    }
    return
  }
  for (const skill of skills) {
    const row = page.getByText(skill, { exact: true }).last()
    if (!(await row.isVisible().catch(() => false))) continue
    const container = row.locator('xpath=ancestor::*[self::div or self::li][1]')
    const advanced = await firstVisible([
      container.getByText(/продвинутый|advanced/i)
    ])
    if (!advanced) throw profileFillerError('profile_hh_skill_level_missing',
      `Advanced level control was not found for skill "${skill}".`, 'fill_resume')
    const selected = await advanced.getAttribute('aria-checked') === 'true' ||
      await advanced.getAttribute('aria-selected') === 'true' ||
      await advanced.isChecked().catch(() => false)
    if (!selected) await advanced.click()
  }
}

export async function setWorkPreferences(page: Page, _market: 'Ru' | 'En') {
  const selected = async (option: Locator) =>
    (await option.getAttribute('aria-selected').catch(() => null)) === 'true' ||
    await option.locator('input[type="checkbox"], input[type="radio"]').first()
      .isChecked().catch(() => false)
  const ensureOptionsOpen = async (activator: Locator, optionQa: string) => {
    const option = page.locator(`[data-qa="${optionQa}"]:visible`)
    if (!(await option.isVisible().catch(() => false))) {
      await activator.click()
      await option.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
    }
    return option
  }

  const formatActivator = await firstVisible([
    page.locator('[data-qa="resume-edit-work-formats"]:visible'),
    page.locator('[role="combobox"]:visible').filter({ hasText: /Формат работы/i }),
    page.locator('[data-qa="magritte-select-activator"]:visible')
      .filter({ hasText: /Формат работы/i })
  ])
  if (!formatActivator) throw profileFillerError('profile_hh_work_format_missing',
    'HH work format select was not found.', 'fill_resume')
  const formats = [
    { qa: 'magritte-select-option-ON_SITE', wanted: true },
    { qa: 'magritte-select-option-REMOTE', wanted: true },
    { qa: 'magritte-select-option-HYBRID', wanted: true },
    { qa: 'magritte-select-option-FIELD_WORK', wanted: false },
    { qa: 'magritte-select-option-FLY_IN_FLY_OUT', wanted: false }
  ]
  for (const format of formats) {
    const option = await ensureOptionsOpen(formatActivator, format.qa)
    if (!(await option.isVisible().catch(() => false))) throw profileFillerError(
      'profile_hh_work_format_missing', `HH work format option was not found: ${format.qa}.`,
      'fill_resume')
    if (await selected(option) !== format.wanted) {
      await option.click()
      await page.waitForTimeout(200)
    }
  }
  for (const format of formats) {
    const option = page.locator(`[data-qa="${format.qa}"]:visible`)
    if (!(await option.isVisible().catch(() => false)) ||
        await selected(option) !== format.wanted) {
      throw profileFillerError('profile_hh_work_format_not_selected',
        `HH did not retain work format state: ${format.qa}.`, 'fill_resume')
    }
  }
  const chooseFormats = await firstVisible([
    page.getByRole('button', { name: /^(?:Выбрать|Choose|Select)$/i }).last(),
    page.getByText(/^(?:Выбрать|Choose|Select)$/i).last()
  ])
  if (!chooseFormats) throw profileFillerError('profile_hh_work_format_confirm_missing',
    'HH work format confirmation control was not found.', 'fill_resume')
  await chooseFormats.click()
  await page.waitForTimeout(250)

  const travelActivator = await firstVisible([
    page.locator('[data-qa="resume-edit-business-trip-readiness"]:visible'),
    page.locator('[role="combobox"]:visible').filter({ hasText: /Командировки/i }),
    page.locator('[data-qa="magritte-select-activator"]:visible')
      .filter({ hasText: /Командировки/i })
  ])
  if (!travelActivator) throw profileFillerError('profile_hh_travel_control_missing',
    'HH business trips select was not found.', 'fill_resume')
  const ready = await ensureOptionsOpen(travelActivator, 'magritte-select-option-ready')
  if (!(await ready.isVisible().catch(() => false))) throw profileFillerError(
    'profile_hh_travel_control_missing', 'HH business trips Ready option was not found.',
    'fill_resume')
  if (!(await selected(ready))) await ready.click()
  if (await ready.isVisible().catch(() => false)) {
    if (!(await selected(ready))) throw profileFillerError('profile_hh_travel_not_selected',
      'HH did not retain Ready business-trip state.', 'fill_resume')
    await page.keyboard.press('Escape').catch(() => undefined)
  }
}

async function verifyWorkPreferences(page: Page): Promise<void> {
  const selected = async (option: Locator) =>
    (await option.getAttribute('aria-selected').catch(() => null)) === 'true' ||
    await option.locator('input[type="checkbox"], input[type="radio"]').first()
      .isChecked().catch(() => false)
  const formatActivator = await firstVisible([
    page.locator('[data-qa="resume-edit-work-formats"]:visible'),
    page.locator('[data-qa="resume-edit-work-formats"]:visible'),
    page.locator('[role="combobox"]:visible').filter({ hasText: /Формат работы/i })
  ])
  if (!formatActivator) throw profileFillerError('profile_hh_work_format_missing',
    'HH work format select was not found during verification.', 'verify_draft')
  await formatActivator.click()
  const requiredFormats = ['ON_SITE', 'REMOTE', 'HYBRID']
  const forbiddenFormats = ['FIELD_WORK', 'FLY_IN_FLY_OUT']
  for (const code of requiredFormats) {
    const option = page.locator(`[data-qa="magritte-select-option-${code}"]:visible`)
    await option.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
    if (!(await option.isVisible().catch(() => false)) || !(await selected(option))) {
      throw profileFillerError('profile_hh_work_format_not_persisted',
        `HH did not persist required work format: ${code}.`, 'verify_draft')
    }
  }
  for (const code of forbiddenFormats) {
    const option = page.locator(`[data-qa="magritte-select-option-${code}"]:visible`)
    if (await option.isVisible().catch(() => false) && await selected(option)) {
      throw profileFillerError('profile_hh_work_format_not_persisted',
        `HH persisted an unwanted work format: ${code}.`, 'verify_draft')
    }
  }
  await page.keyboard.press('Escape').catch(() => undefined)
  const travelActivator = await firstVisible([
    page.locator('[data-qa="resume-edit-business-trip-readiness"]:visible'),
    page.locator('[data-qa="resume-edit-business-trip-readiness"]:visible'),
    page.locator('[role="combobox"]:visible').filter({ hasText: /Командировки/i })
  ])
  if (!travelActivator) throw profileFillerError('profile_hh_travel_control_missing',
    'HH business trips select was not found during verification.', 'verify_draft')
  await travelActivator.click()
  const ready = page.locator('[data-qa="magritte-select-option-ready"]:visible')
  await ready.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
  if (!(await ready.isVisible().catch(() => false)) || !(await selected(ready))) {
    throw profileFillerError('profile_hh_travel_not_persisted',
      'HH did not persist Ready business-trip state.', 'verify_draft')
  }
  await page.keyboard.press('Escape').catch(() => undefined)
}

async function setPreferredEmail(page: Page) {
  const direct = page.locator('[data-qa="resume-editor-preferred-contact-email-checked"]')
  if (await direct.count()) {
    if (!(await direct.isChecked().catch(() => false))) {
      await direct.locator('xpath=ancestor::label[1]').click()
    }
    if (!(await direct.isChecked().catch(() => false))) throw profileFillerError(
      'profile_hh_preferred_email_not_selected',
      'HH did not select email as the preferred contact.', 'fill_resume')
    await page.waitForTimeout(500)
    return
  }
  // The current Russian HH contacts editor renders one inline radio beside
  // every contact and spells the label "Предпочитаемый способ связи". Older
  // versions opened a separate chooser. The email option is the last matching
  // inline label because the phone block is rendered first.
  const emailOption = await firstVisible([
    page.getByText(/предпочитаем(?:ый|ая)\s+способ\s+связи/i).last(),
    page.getByText(/предпочтительн(?:ый|ая)\s+способ\s+связи/i).last(),
    page.getByText(/preferred contact/i).last()
  ])
  if (!emailOption) throw profileFillerError('profile_hh_control_missing',
    'Required HH preferred email control was not found.', 'fill_resume')
  const input = emailOption.locator('xpath=ancestor::label[1]')
    .locator('input[type="radio"], input[type="checkbox"]').first()
  const roleControl = emailOption.locator('xpath=ancestor::*[@role="radio" or @role="checkbox"][1]')
  const checked = await input.count()
    ? await input.isChecked().catch(() => false)
    : await roleControl.count()
      ? (await roleControl.getAttribute('aria-checked').catch(() => null)) === 'true'
      : false
  if (!checked) await emailOption.click()
}

export const SAVE_AND_CONTINUE_PATTERNS = [
  /сохранить\s+и\s+продолжить/i,
  /save\s+and\s+continue/i
]

const SPECIALIZATION_HEADING =
  /^(?:Уточните специальность|(?:Refine|Specify) (?:the )?speciali[sz]ation)$/i

function specializationHeading(page: Page): Locator {
  return page.getByText(SPECIALIZATION_HEADING).last()
}

function specializationContainer(page: Page): Locator {
  return specializationHeading(page)
    .locator('xpath=ancestor::*[.//*[@data-qa="tree-selector-search-input"] and ' +
      './/*[contains(normalize-space(.), "Сохранить") or contains(normalize-space(.), "Save")]][1]')
}

async function waitForWizardTransition(page: Page, previousUrl: string,
  previousScreen?: string | null): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const currentScreen = await page.locator('[data-qa*="resume-profile-screen"]:visible').first()
      .getAttribute('data-qa').catch(() => undefined)
    if (page.url() !== previousUrl ||
        (previousScreen && currentScreen && currentScreen !== previousScreen)) return true
    await page.waitForTimeout(500)
  }
  return false
}

function wizardValidation(bodyText: string): string | undefined {
  return bodyText.split(/\r?\n/).map(line => line.trim()).find(line =>
    /^(?:укажите|выберите|заполните|добавьте|enter|select|specify|required)/i.test(line) &&
    !/^(?:заполните основную информацию|fill in (?:the )?basic information|выберите или укажите профессию|(?:choose|select|specify).*(?:profession|job role))$/i.test(line))
}

export async function nextWizardStep(page: Page, stage: string,
  options: { area?: string } = {}) {
  const area = options.area ? areaSelectionValue(options.area) : undefined
  const previousUrl = page.url()
  const previousScreen = await page.locator('[data-qa*="resume-profile-screen"]:visible').first()
    .getAttribute('data-qa').catch(() => undefined)
  for (let submitAttempt = 0; submitAttempt < 2; submitAttempt += 1) {
    await page.waitForTimeout(500)
    if (area) await selectAreaSuggestion(page, area)
    const next = await firstVisible([
      page.locator('[data-qa="resume-profile-next-screen"]'),
      page.getByText(SAVE_AND_CONTINUE_PATTERNS[0]).last(),
      page.getByText(SAVE_AND_CONTINUE_PATTERNS[1]).last()
    ])
    if (!next) throw profileFillerError('profile_hh_control_missing',
      `Required HH control was not found: ${SAVE_AND_CONTINUE_PATTERNS[0]}.`, 'fill_resume')
    try {
      await next.click({ timeout: 5000 })
    } catch (error) {
      // HH can accept the button press and then demand confirmation of an area
      // whose text is present but whose suggestion was never selected. Confirm
      // that exact result and let the bounded outer loop retry the button.
      if (!area || !(await visibleAreaSheet(page, area))) throw error
      await selectAreaSuggestion(page, area, true)
      if (submitAttempt === 1) throw profileFillerError('profile_hh_area_not_accepted',
        `HH requested city confirmation again for "${area}".`, 'fill_resume')
      continue
    }
    await page.waitForTimeout(300)
    if (area && await visibleAreaSheet(page, area)) {
      await selectAreaSuggestion(page, area, true)
      if (submitAttempt === 1) throw profileFillerError('profile_hh_area_not_accepted',
        `HH requested city confirmation again for "${area}".`, 'fill_resume')
      continue
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => undefined)
    if (await waitForWizardTransition(page, previousUrl, previousScreen)) return

    if (area && await visibleAreaSheet(page, area)) {
      await selectAreaSuggestion(page, area, true)
      if (submitAttempt === 1) throw profileFillerError('profile_hh_area_not_accepted',
        `HH requested city confirmation again for "${area}".`, 'fill_resume')
      continue
    }

    const bodyText = await page.locator('body').innerText()
    if (/код.*подтверждени|verification code|confirm.*phone/i.test(bodyText)) {
      throw profileFillerError('profile_hh_phone_verification_required',
        'HH requires interactive phone verification.', 'create_resume')
    }
    const validation = wizardValidation(bodyText)
    if (validation) {
      throw profileFillerError('profile_hh_wizard_validation_failed',
        `HH did not advance from the ${stage} step: ${validation}`, 'fill_resume')
    }
  }
  throw profileFillerError('profile_hh_wizard_validation_failed',
    `HH did not advance from the ${stage} step after retrying the completed form.`, 'fill_resume')
}

async function saveChangesWithoutPublishing(page: Page) {
  const candidates = [
    page.locator('[data-qa="profile-layout-save-button"]:visible'),
    page.getByText(/^сохранить изменения$/i), page.getByText(/^save changes$/i),
    page.getByText(/^сохранить$/i), page.getByText(/^save$/i)
  ]
  const button = await firstVisible(candidates)
  if (!button) {
    throw profileFillerError('profile_hh_safe_save_missing',
      'A safe HH save control was not found; the resume was not published.', 'save_draft')
  }
  const text = String(await button.innerText().catch(() => '')).toLowerCase()
  if (/публиков|publish|разместить|post/.test(text)) {
    throw profileFillerError('profile_hh_publish_control_blocked',
      'Refused to click an HH control that could publish the resume.', 'save_draft')
  }
  const previousUrl = page.url()
  await button.click()
  const navigated = await page.waitForURL(url => url.toString() !== previousUrl, {
    timeout: 20_000
  }).then(() => true).catch(() => false)
  if (!navigated) await page.waitForTimeout(3_000)
  else await page.waitForTimeout(800)
  return true
}

async function setResumeTitle(page: Page, value: string): Promise<void> {
  const input = await field(page, ['Профессия', 'Position', 'Resume title'], [
    '[data-qa="resume-edit-title-suggest"]', 'input[name="title"]',
    '[data-qa="resume-block-title-position"] input', '[data-qa*="title"] input'
  ])
  if (!input) throw profileFillerError('profile_hh_title_edit_missing',
    'HH resume title edit control was not found.', 'fill_resume')
  if (String(await input.inputValue().catch(() => '')).trim() !== value.trim()) {
    await input.fill(value)
    // The title autocomplete keeps its previous value when Escape closes it
    // while the input is focused. Blur first so React commits the free-text
    // title, then close only the now-detached suggestion sheet.
    await input.blur()
    await page.waitForTimeout(200)
  }
  await closeBottomSheets(page)
  if (String(await input.inputValue().catch(() => '')).trim() !== value.trim()) {
    throw profileFillerError('profile_hh_title_not_accepted',
      `HH did not retain the requested title "${value}" before saving.`, 'fill_resume')
  }
}

export async function chooseFirstSuggestion(page: Page, value: string): Promise<boolean> {
  let option: Locator | undefined
  for (let attempt = 0; attempt < 20 && !option; attempt += 1) {
    option = await firstVisible([
      page.locator('[data-qa="bottom-sheet-css-variables"]:visible')
        .getByText(value, { exact: true }).last(),
      page.getByText(value, { exact: true }).last()
    ])
    if (!option) await page.waitForTimeout(500)
  }
  if (!option) return false
  await option.click()
  // HH replaces the profession sheet with the specialization sheet asynchronously.
  // The profession sheet also contains a tree-selector search input, and HH no
  // longer guarantees a data-qa on the specialization submit button. Its
  // heading is the stable discriminator between the two mounted sheets.
  await specializationHeading(page)
    .waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
  return true
}

export function specializationForStack(stack: string, _market: 'Ru' | 'En') {
  void stack
  return { query: 'разработчик', label: INITIAL_HH_PROFESSION }
}

export function professionForTitle(title: string, market: 'Ru' | 'En'): string {
  return market === 'Ru' ? title.trim() : (title.split('/').pop() ?? title).trim()
}

export function legacyProfessionForTitle(title: string, market: 'Ru' | 'En'): string {
  const [ruTitle, enTitle] = title.split('/').map(value => value.trim())
  const selected = market === 'Ru' ? ruTitle : (enTitle || ruTitle)
  return selected
    .replace(/\bFullstack\b/gi, market === 'Ru' ? 'фуллстэк' : 'Fullstack')
    .replace(/\bBackend\b/gi, market === 'Ru' ? 'бэкенд' : 'Backend')
    .replace(/\bFrontend\b/gi, market === 'Ru' ? 'фронтенд' : 'Frontend')
}

function phoneFromText(value: string): string | undefined {
  return value.match(/\+\d(?:[\d\s()\-]{7,}\d)/)?.[0].trim()
}

function birthDateFromText(value: string): string | undefined {
  return value.match(/\b(?:0[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])\.(?:19|20)\d{2}\b/)?.[0]
}

async function existingConfirmedPhone(page: Page, resumes: ResumeSnapshot[]): Promise<string | undefined> {
  for (const resume of resumes) {
    await page.goto(resume.href, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const bodyText = await page.locator('body').innerText().catch(() => '')
    const phone = phoneFromText(bodyText)
    if (phone) return phone
  }
  return undefined
}

async function existingConfirmedBirthDate(page: Page,
  resumes: ResumeSnapshot[]): Promise<string | undefined> {
  for (const resume of resumes) {
    await page.goto(resume.href, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const bodyText = await page.locator('body').innerText().catch(() => '')
    const birthDate = birthDateFromText(bodyText)
    if (birthDate) return birthDate
  }
  return undefined
}

export async function selectRequiredSpecialization(page: Page, stack: string,
  market: 'Ru' | 'En'): Promise<boolean> {
  const sheet = specializationContainer(page)
  await sheet.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
  const search = await firstVisible([
    sheet.locator('[data-qa="tree-selector-search-input"]')
  ])
  if (!search) return false
  const specialization = specializationForStack(stack, market)
  await search.fill(specialization.query)
  await page.waitForTimeout(500)
  const exactText = page.getByText(specialization.label, { exact: true }).last()
  const rowFromText = exactText.locator(
    'xpath=ancestor::*[.//input[@type="checkbox" or @type="radio"] or .//*[@role="checkbox"]][1]'
  )
  const option = await firstVisible([
    sheet.locator('[data-qa^="tree-selector-item"]').filter({ hasText: specialization.label }),
    sheet.getByText(specialization.label, { exact: true }),
    rowFromText,
    exactText
  ])
  if (!option) {
    throw profileFillerError('profile_hh_specialization_missing',
      `HH did not offer the required specialization "${specialization.label}".`, 'fill_resume')
  }
  // HH visually hides the native checkbox. isVisible() therefore produces a
  // false negative even when React has checked it; inspect its state instead.
  let selected = false
  const nativeInput = rowFromText.locator(
    '[data-qa^="tree-selector-input"], input[type="checkbox"], input[type="radio"]'
  ).first()
  const alreadySelected = await nativeInput.isChecked().catch(() => false) ||
    (await option.getAttribute('aria-checked').catch(() => null)) === 'true'
  if (!alreadySelected) await option.click()
  for (let attempt = 0; attempt < 20 && !selected; attempt += 1) {
    selected = await nativeInput.isChecked().catch(() => false) ||
      (await option.getAttribute('aria-checked').catch(() => null)) === 'true' ||
      (await nativeInput.getAttribute('aria-checked').catch(() => null)) === 'true'
    if (!selected) await page.waitForTimeout(100)
  }
  if (!selected) {
    throw profileFillerError('profile_hh_specialization_not_selected',
      `HH did not select the specialization "${specialization.label}".`, 'fill_resume')
  }
  const submit = await firstVisible([
    sheet.locator('[data-qa="category-modal-submit"]'),
    sheet.getByText(SAVE_AND_CONTINUE_PATTERNS[0]).last(),
    sheet.getByText(SAVE_AND_CONTINUE_PATTERNS[1]).last(),
    page.getByText(SAVE_AND_CONTINUE_PATTERNS[0]).last(),
    page.getByText(SAVE_AND_CONTINUE_PATTERNS[1]).last()
  ])
  if (!submit) {
    throw profileFillerError('profile_hh_specialization_submit_missing',
      'HH specialization confirmation control was not found.', 'fill_resume')
  }
  await submit.click()
  await sheet.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
  return true
}

async function openSpecializationPicker(page: Page): Promise<void> {
  const heading = specializationHeading(page)
  if (!(await heading.isVisible().catch(() => false))) {
    const next = await firstVisible([page.locator('[data-qa="resume-profile-next-screen"]')])
    if (!next) throw profileFillerError('profile_hh_control_missing',
      'Required HH profession continue control was not found.', 'create_resume')
    await next.click()
    await heading.waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => undefined)
  }
  if (!(await heading.isVisible().catch(() => false))) {
    const bodyText = await page.locator('body').innerText()
    const duplicate = /у вас уже существует резюме с такой должностью|resume with this position already exists/i
      .test(bodyText)
    throw profileFillerError(duplicate
      ? 'profile_hh_profession_duplicate' : 'profile_hh_specialization_missing', duplicate
      ? 'HH already has an incomplete resume with this profession.'
      : 'HH did not open the required specialization picker.', 'create_resume')
  }
}

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
]

const MONTH_NAMES_RU_GENITIVE = [
  'Января', 'Февраля', 'Марта', 'Апреля', 'Мая', 'Июня',
  'Июля', 'Августа', 'Сентября', 'Октября', 'Ноября', 'Декабря'
]

function dateParts(value: string): { day: string; month: number; year: string } | undefined {
  const dotted = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const day = Number(dotted?.[1] ?? iso?.[3])
  const month = Number(dotted?.[2] ?? iso?.[2])
  const year = Number(dotted?.[3] ?? iso?.[1])
  if (!Number.isInteger(day) || day < 1 || day > 31 ||
      !Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) return undefined
  return { day: String(day).padStart(2, '0'), month, year: String(year) }
}

async function selectBirthDatePart(page: Page, control: Locator,
  optionPatterns: RegExp[]): Promise<boolean> {
  await control.click()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const option = await firstVisible(optionPatterns.flatMap(pattern => [
      page.getByRole('option', { name: pattern }),
      page.getByText(pattern).last()
    ]))
    if (option) {
      await option.click()
      return true
    }
    await page.waitForTimeout(100)
  }
  return false
}

export async function fillBirthDate(page: Page, value?: string): Promise<boolean> {
  if (!value) return false
  const parts = dateParts(value)
  if (!parts) throw profileFillerError('profile_hh_birth_date_invalid',
    'HH birth date must use DD.MM.YYYY or YYYY-MM-DD format.', 'fill_resume')

  const day = await firstVisible([
    page.locator('[data-qa="resume-profile-common-birthday-day-input"]')
  ])
  if (!day) {
    const input = await field(page, ['Дата рождения', 'Birth date'], [
      'input[name="birthday"]', 'input[name*="birth"]'
    ])
    if (!input) return false
    const expected = `${parts.day}.${String(parts.month).padStart(2, '0')}.${parts.year}`
    const current = String(await input.inputValue().catch(() => '')).trim()
    if (current !== expected) {
      await input.fill(expected)
      await input.press('Tab').catch(() => undefined)
      await page.waitForTimeout(100)
    }
    if (String(await input.inputValue().catch(() => '')).trim() !== expected) {
      throw profileFillerError('profile_hh_birth_date_not_selected',
        'HH did not preserve the exact birth date in DD.MM.YYYY format.', 'fill_resume')
    }
    return true
  }
  const monthName = MONTH_NAMES_RU[parts.month - 1]
  const monthNameGenitive = MONTH_NAMES_RU_GENITIVE[parts.month - 1]
  const month = await firstVisible([
    page.locator('[data-qa="magritte-select-activator"][aria-label="Месяц"]'),
    page.locator('[data-qa="magritte-select-activator"][aria-label="Month"]'),
    page.locator('[data-qa="resume-profile-common-birthday-month-select"]'),
    page.locator('[data-qa="resume-profile-common-birthday-month"]'),
    page.getByText(new RegExp(`^(?:${monthName}|${monthNameGenitive})$`, 'i')).last(),
    page.getByText(/^(?:Месяц|Month)$/).last()
  ])
  const year = await firstVisible([
    page.locator('[data-qa="magritte-select-activator"][aria-label="Год"]'),
    page.locator('[data-qa="magritte-select-activator"][aria-label="Year"]'),
    page.locator('[data-qa="resume-profile-common-birthday-year-select"]'),
    page.locator('[data-qa="resume-profile-common-birthday-year"]'),
    page.getByText(new RegExp(`^${parts.year}$`)).last(),
    page.getByText(/^(?:Год|Year)$/).last()
  ])
  if (!month || !year) throw profileFillerError('profile_hh_required_field_missing',
    'Required HH birth date month or year control was not found.', 'fill_resume')

  const currentDay = String(await day.inputValue().catch(() => '')).trim().padStart(2, '0')
  const currentMonth = await birthDateControlValue(month)
  const currentYear = await birthDateControlValue(year)
  if (currentDay === parts.day &&
      (currentMonth.toLowerCase() === monthName.toLowerCase() ||
        currentMonth.toLowerCase() === monthNameGenitive.toLowerCase() ||
        currentMonth === String(parts.month)) && currentYear === parts.year) return true

  if (currentDay !== parts.day) await day.fill(parts.day)
  if (currentMonth.toLowerCase() !== monthName.toLowerCase() &&
      currentMonth.toLowerCase() !== monthNameGenitive.toLowerCase() &&
      currentMonth !== String(parts.month) && !(await selectBirthDatePart(page, month, [
    new RegExp(`^${monthName}$`, 'i'), new RegExp(`^${monthNameGenitive}$`, 'i'),
    new RegExp(`^${parts.month}$`)
  ]))) throw profileFillerError('profile_hh_birth_date_not_selected',
    `HH did not select birth month ${parts.month}.`, 'fill_resume')
  if (currentYear !== parts.year &&
      !(await selectBirthDatePart(page, year, [new RegExp(`^${parts.year}$`)]))) {
    throw profileFillerError('profile_hh_birth_date_not_selected',
      `HH did not select birth year ${parts.year}.`, 'fill_resume')
  }
  return true
}

async function fillSupplemental(page: Page, profile: PreparedProfile, title: string) {
  const id = resumeId(page.url())
  if (!id) throw profileFillerError('profile_hh_resume_not_created',
    'HH draft ID is unavailable for supplemental editing.', 'fill_resume')

  await page.goto(`https://hh.ru/resume/edit/${id}/position`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  const desiredTitle = professionForTitle(title, profile.client.market)
  await setResumeTitle(page, desiredTitle)
  await setWorkPreferences(page, profile.client.market)
  await saveChangesWithoutPublishing(page)
  await page.goto(`https://hh.ru/resume/edit/${id}/position`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  const persistedTitle = await field(page, ['Профессия', 'Position', 'Resume title'], [
    '[data-qa="resume-edit-title-suggest"]', 'input[name="title"]',
    '[data-qa="resume-block-title-position"] input', '[data-qa*="title"] input'
  ])
  if (String(await persistedTitle?.inputValue().catch(() => '') ?? '').trim() !==
      desiredTitle.trim()) throw profileFillerError('profile_hh_title_verification_failed',
    `HH did not persist the requested title "${desiredTitle}".`, 'verify_draft')
  await verifyWorkPreferences(page)

  await page.goto(`https://hh.ru/resume/edit/${id}/contacts`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  await fill(page, profile.cv.contacts.email, ['Электронная почта', 'Email'],
    ['[data-qa="resume-editor-email-input"]', 'input[type="email"]', 'input[name="email"]'], true)
  await fill(page, profile.cv.contacts.phone, ['Мобильный телефон', 'Phone'], [
    '[data-qa="resume-phone-cell_phone"]', 'input[name="phone.formatted"]'
  ])
  let preferredEmailPersisted = false
  for (let attempt = 0; attempt < 2 && !preferredEmailPersisted; attempt += 1) {
    await setPreferredEmail(page)
    await saveChangesWithoutPublishing(page)
    await page.goto(`https://hh.ru/resume/edit/${id}/contacts`, {
      waitUntil: 'domcontentloaded', timeout: 120_000
    })
    const preferredEmail = page.locator(
      '[data-qa="resume-editor-preferred-contact-email-checked"]')
    preferredEmailPersisted = Boolean(await preferredEmail.count()) &&
      await preferredEmail.isChecked().catch(() => false)
  }
  if (!preferredEmailPersisted) {
    throw profileFillerError('profile_hh_preferred_email_not_persisted',
      'HH did not persist email as the preferred contact.', 'verify_draft')
  }

  await page.goto(`https://hh.ru/resume/edit/${id}/about`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  await fill(page, profile.about, ['О себе', 'About me'], [
    '[data-qa="resume-editor-about"]', 'textarea[name="about"]', '[data-qa*="about"] textarea'
  ], true)
  await saveChangesWithoutPublishing(page)

  await page.goto('https://hh.ru/profile/block/languages', {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  await fillProfileLanguages(page, profile.cv.languages)
  if (profile.client.market === 'En') {
    await updateAndVerifyWorkPermits(page)
  }
}

export async function resumeDraftFromWorkPermits(page: Page, profile: PreparedProfile,
  title: string, id: string): Promise<ResumeSnapshot> {
  if (profile.client.market === 'En') await updateAndVerifyWorkPermits(page)
  const expectedTitle = professionForTitle(title, profile.client.market).trim()
  const resume = (await listResumes(page)).find(item => item.id === id)
  if (!resume) throw profileFillerError('profile_hh_resume_not_found',
    `HH draft ${id} was not found after resuming from work permits.`, 'verify_draft')
  if (!resume.isDraft) throw profileFillerError('profile_hh_unexpected_publication',
    `Resume ${id} is not marked as a draft.`, 'verify_draft')
  if (resume.title.trim() !== expectedTitle) throw profileFillerError(
    'profile_hh_title_verification_failed',
    `HH draft title does not match the requested title "${expectedTitle}".`, 'verify_draft')
  return resume
}

export async function verifyKnownDraft(page: Page, title: string, id: string,
  artifactDir?: string): Promise<ResumeSnapshot> {
  const expectedTitle = title.trim()
  await page.goto(`https://hh.ru/resume/edit/${id}/position`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  const titleInput = await field(page, ['Профессия', 'Position', 'Resume title'], [
    '[data-qa="resume-edit-title-suggest"]', 'input[name="title"]',
    '[data-qa="resume-block-title-position"] input', '[data-qa*="title"] input'
  ])
  const actualTitle = String(await titleInput?.inputValue().catch(() => '') ?? '').trim()
  if (!actualTitle || actualTitle !== expectedTitle) throw profileFillerError(
    'profile_hh_title_verification_failed',
    `HH resume ${id} does not have the requested title "${expectedTitle}".`, 'verify_draft')

  await page.goto(`https://hh.ru/profile/resume?resume=${encodeURIComponent(id)}`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  const draftScreen = page.locator('[data-qa*="resume-profile-screen"]:visible').first()
  if (!(await draftScreen.isVisible().catch(() => false)) ||
      !/\/profile\/resume\//i.test(new URL(page.url()).pathname)) {
    throw profileFillerError('profile_hh_unexpected_publication',
      `HH resume ${id} no longer opens as an unfinished draft.`, 'verify_draft')
  }
  if (artifactDir) await captureArtifactScreenshot(page, path.join(artifactDir, `final-draft-${id}.png`))
  return { id, title: actualTitle, href: `https://hh.ru/resume/${id}`,
    statusText: 'verified through unfinished HH draft wizard', isDraft: true }
}

export async function resumeDraftFromExperience(page: Page, profile: PreparedProfile,
  title: string, id: string, artifactDir: string,
  targetResumeIds: string[] = [id]): Promise<ResumeSnapshot> {
  const expectedTitle = professionForTitle(title, profile.client.market).trim()
  await page.goto(`https://hh.ru/resume/edit/${id}/position`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  const titleInput = await field(page, ['Профессия', 'Position', 'Resume title'], [
    '[data-qa="resume-edit-title-suggest"]', 'input[name="title"]',
    '[data-qa="resume-block-title-position"] input', '[data-qa*="title"] input'
  ])
  const actualTitle = String(await titleInput?.inputValue().catch(() => '') ?? '').trim()
  if (!actualTitle || actualTitle !== expectedTitle) throw profileFillerError(
    'profile_hh_title_verification_failed',
    `HH resume ${id} does not have the requested title "${expectedTitle}".`, 'verify_draft')

  const publishedHostId = (await listResumes(page)).find(item => !item.isDraft)?.id

  const experienceUrl = `https://hh.ru/profile/resume/experience?resume=${encodeURIComponent(id)}`
  await page.goto(experienceUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForTimeout(1500)
  const screen = page.locator('[data-qa*="resume-profile-screen_experience"]:visible')
  if (!(await screen.isVisible().catch(() => false))) return await resumePublishedFromExperience(
    page, profile, actualTitle, id, artifactDir, targetResumeIds)

  for (const item of profile.cv.experience) {
    if (await hasResumeExperienceCard(page, item)) continue
    if (!(await addDraftExperienceThroughProfile(page, item, id, artifactDir,
      publishedHostId, targetResumeIds))) throw profileFillerError(
      'profile_hh_experience_control_missing',
      `HH could not add experience for ${item.company}.`, 'fill_resume')
    await page.goto(experienceUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(1000)
  }

  await syncResumeExperienceSelection(page, profile.cv.experience)
  await page.waitForTimeout(700)
  await page.goto(experienceUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForTimeout(1000)
  await syncResumeExperienceSelection(page, profile.cv.experience, true)
  await captureArtifactScreenshot(page,
    path.join(artifactDir, `verified-experience-${id}.png`))
  return { id, title: actualTitle, href: `https://hh.ru/resume/${id}`,
    statusText: 'experience verified in unfinished HH draft', isDraft: true }
}

export async function readPersistedSkills(page: Page, id: string): Promise<SavedSkills> {
  await page.goto(`https://hh.ru/resume/${encodeURIComponent(id)}`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  const card = page.locator('[data-qa="skills-card"]:visible')
  if (!(await card.isVisible().catch(() => false))) throw profileFillerError(
    'profile_hh_skills_not_readable', 'Persisted resume skills cannot be read.', 'verify_skills')
  return {
    tags: (await card.locator('[data-qa^="skill-tag-"]:visible').allInnerTexts()).map(contentText),
    advanced: (await card.locator('[data-qa="skill-level-title-3"]:visible')
      .locator('xpath=..').locator('[data-qa^="skill-tag-"]:visible').allInnerTexts()).map(contentText)
  }
}

async function syncStrictSkills(page: Page, profile: PreparedProfile, resume: ResumeSnapshot): Promise<SavedSkills> {
  const saveTags = async (skills: string[]) => {
    if (resume.isDraft) {
      await page.goto(`https://hh.ru/profile/resume/keyskills?resume=${encodeURIComponent(resume.id)}`, {
        waitUntil: 'domcontentloaded', timeout: 120_000
      })
      await addSkills(page, skills)
      await nextWizardStep(page, 'skills')
    } else {
      await page.goto(`https://hh.ru/resume/edit/${resume.id}/keySkills`, {
        waitUntil: 'domcontentloaded', timeout: 120_000
      })
      await fillDirectSkillsEditor(page, skills)
      await saveChangesWithoutPublishing(page)
    }
  }
  return await ensureThirtyAdvanced({
    same: sameSkill,
    read: () => readPersistedSkills(page, resume.id), saveTags,
    async saveAdvanced(tags) {
      if (resume.isDraft) {
        await saveTags(tags)
      } else {
        await readPersistedSkills(page, resume.id)
        const control = page.locator('[data-qa="skills-card"]:visible')
          .getByRole('button', { name: /^(?:Указать уровень|Оценить навыки|Редактировать уровни|Edit levels)$/i })
        if (await control.count() !== 1) throw profileFillerError('profile_hh_skill_level_missing',
          'A resume-scoped skill level editor is unavailable.', 'fill_skills')
        await control.click()
      }
      const rows = page.locator('[data-qa="skill"]:visible')
      const names = await rows.locator('[data-qa="skillName"]').allInnerTexts()
      if (names.length !== 30 || tags.some(tag => !names.some(name => sameSkill(tag, name)))) {
        throw profileFillerError('profile_hh_thirty_levels_unavailable',
          'HH does not expose Advanced controls for all 30 saved skills.', 'fill_skills')
      }
      await setAllSkillsAdvanced(page, tags)
      if (resume.isDraft) await nextWizardStep(page, 'skill levels')
      else await saveChangesWithoutPublishing(page)
    }
  }, profile.cv.skills)
}

export async function resumeSkills(page: Page, profile: PreparedProfile,
  title: string, id: string, artifactDir: string): Promise<ResumeSnapshot> {
  const before = (await listResumes(page)).find(item => item.id === id)
  if (!before || before.title !== professionForTitle(title, profile.client.market)) throw profileFillerError(
    'profile_hh_resume_not_found', 'Skill recovery requires the exact known resume and title.', 'verify_skills')
  const saved = await syncStrictSkills(page, profile, before)
  fs.writeFileSync(path.join(artifactDir, `verified-skills-${id}.json`), JSON.stringify({
    resumeId: id, count: saved.tags.length, advanced: saved.advanced.length
  }), { mode: 0o600 })
  return before
}

async function fillPublishedResumeCore(page: Page, profile: PreparedProfile,
  resume: ResumeSnapshot): Promise<ResumeSnapshot> {
  await page.goto(`https://hh.ru/resume/${resume.id}/experience`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  for (const item of profile.cv.experience) {
    if (!/\/resume\/[a-z0-9]+\/experience/i.test(new URL(page.url()).pathname)) {
      await page.goto(`https://hh.ru/resume/${resume.id}/experience`, {
        waitUntil: 'domcontentloaded', timeout: 120_000
      })
    }
    if (await page.getByText(item.company, { exact: false }).isVisible().catch(() => false)) continue
    if (!(await addExperience(page, item))) {
      throw profileFillerError('profile_hh_experience_control_missing',
        `HH could not add published-resume experience for ${item.company}.`, 'fill_resume')
    }
  }

  await page.goto(`https://hh.ru/resume/edit/${resume.id}/about`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  await fill(page, profile.about, ['О себе', 'About me'], [
    '[data-qa="resume-editor-about"]', 'textarea[name="about"]'
  ], true)
  await clickText(page, [/^сохранить$/i, /^save$/i], true)
  await page.waitForTimeout(700)

  const updated = (await listResumes(page)).find(item => item.id === resume.id)
  return updated ?? resume
}

export async function createResumeDraft(page: Page, profile: PreparedProfile,
  title: string, artifactDir: string, existingDraftId?: string): Promise<ResumeSnapshot> {
  const before = await listResumes(page)
  const structuredPhone = profile.cv.contacts.phone || await existingConfirmedPhone(page, before)
  const structuredBirthDate = profile.cv.birthDate ||
    await existingConfirmedBirthDate(page, before)
  const targetTitle = professionForTitle(title, profile.client.market)
  const profession = INITIAL_HH_PROFESSION
  let resumable: ResumeSnapshot | undefined
  let activeDraftId = existingDraftId
  if (existingDraftId) {
    const href = `https://hh.ru/profile/resume/common?resume=${encodeURIComponent(existingDraftId)}`
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    if (!/\/profile\/resume\/common/i.test(new URL(page.url()).pathname)) {
      throw profileFillerError('profile_hh_existing_draft_unavailable',
        `HH incomplete resume ${existingDraftId} cannot be continued.`, 'create_resume')
    }
    resumable = { id: existingDraftId, title: targetTitle, href,
      statusText: 'incomplete', isDraft: true }
  } else {
    if (orderedSkillCandidates(profile.cv).filter((skill, index, all) => !all.slice(0, index).some(other => sameSkill(skill, other))).length < 30) {
      throw profileFillerError('profile_hh_thirty_skills_unavailable',
        'The final CV does not support 30 unique skills for a new resume.', 'prepare_profile')
    }
    const professionStates: ProfessionState[] = []
    const captureProfessionState = async (stage: string) => {
      professionStates.push(await professionState(page, stage))
      fs.writeFileSync(path.join(artifactDir, 'profession-state.json'),
        `${JSON.stringify(professionStates, null, 2)}\n`, { mode: 0o600 })
    }
    await page.goto(HH_NEW_RESUME_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    assertNewResumeEntry(page.url())
    if (/можно создать не более|resume limit|maximum number of resumes/i.test(await page.locator('body').innerText())) {
      throw profileFillerError('profile_hh_resume_limit',
        'HH resume limit prevents creating another draft.', 'create_resume')
    }
    const professionInput = await openProfessionEditor(page)
    await professionInput.fill(profession)
    await captureProfessionState('profession-entered')
    if (!(await chooseFirstSuggestion(page, profession))) {
      throw profileFillerError('profile_hh_profession_suggestion_missing',
        `HH did not offer a profession matching "${profession}".`, 'fill_resume')
    }
    await captureProfessionState('profession-suggestion-selected')
    await openSpecializationPicker(page)
    await captureProfessionState('specialization-opened')
    await selectRequiredSpecialization(page, profile.client.stack, profile.client.market)
    await captureProfessionState('specialization-submitted')
    // The specialization modal's submit is itself a save-and-continue action.
    // Give HH time to complete that transition before touching the underlying
    // profession screen; an early second click can race React state hydration.
    await page.waitForURL(url => /\/profile\/resume\/common/i.test(url.pathname), {
      timeout: 15_000
    }).catch(() => undefined)
    if (!/\/profile\/resume\/common/i.test(new URL(page.url()).pathname)) {
      // The first click can land while HH is replacing the specialization sheet
      // and before the profession screen's React handler is ready. Use the same
      // bounded transition check and single retry as every other wizard screen.
      try {
        await nextWizardStep(page, 'profession')
      } catch (error) {
        await captureProfessionState('profession-transition-failed')
        throw error
      }
    }
    await captureProfessionState('profession-transition-complete')
    await page.waitForURL(url => /\/profile\/resume\/common/i.test(url.pathname) &&
      Boolean(url.searchParams.get('resume')), { timeout: 15_000 }).catch(() => undefined)
    activeDraftId = new URL(page.url()).searchParams.get('resume') ??
      (resumeId(page.url()) || undefined)
    const professionBody = await page.locator('body').innerText()
    if (/у вас уже существует резюме с такой должностью|resume with this position already exists/i
      .test(professionBody)) {
      throw profileFillerError('profile_hh_profession_duplicate',
        `HH already has an incomplete resume for profession "${profession}".`, 'create_resume')
    }
    if (!/\/profile\/resume\/common/i.test(new URL(page.url()).pathname)) {
      throw profileFillerError('profile_hh_profession_not_accepted',
        `HH did not advance after accepting profession "${profession}".`, 'create_resume')
    }
  }

  await fill(page, profile.cv.firstName, ['Имя', 'First name'],
    ['[data-qa="resume-profile-common-name-input"]', 'input[name="firstName"]',
      '[data-qa*="first-name"] input'], true)
  await fill(page, profile.cv.lastName, ['Фамилия', 'Last name'],
    ['[data-qa="resume-profile-common-surname-input"]', 'input[name="lastName"]',
      '[data-qa*="last-name"] input'], true)
  await fill(page, profile.cv.middleName, ['Отчество', 'Middle name'], [
    '[data-qa="resume-profile-common-patronymic-input"]', 'input[name="middleName"]'])
  await fillBirthDate(page, structuredBirthDate)
  // HH's masked birth-date input can restore focus to the surname field while
  // applying the mask. Re-assert identity after the mask settles so date
  // digits cannot be appended to the surname.
  if (structuredBirthDate) {
    await page.waitForTimeout(300)
    await fill(page, profile.cv.lastName, ['Фамилия', 'Last name'],
      ['[data-qa="resume-profile-common-surname-input"]', 'input[name="lastName"]',
        '[data-qa*="last-name"] input'], true)
    await fill(page, profile.cv.firstName, ['Имя', 'First name'],
      ['[data-qa="resume-profile-common-name-input"]', 'input[name="firstName"]',
        '[data-qa*="first-name"] input'], true)
  }
  await setArea(page, profile.cv.location)
  const phoneInput = await field(page, ['Телефон', 'Phone'], [
    '[data-qa="resume-phone-cell_phone"]', 'input[name="phone.formatted"]'])
  if (phoneInput) {
    const currentPhone = String(await phoneInput.inputValue().catch(() => '')).trim()
    if (!currentPhone && !structuredPhone) {
      throw profileFillerError('profile_hh_required_phone_missing',
        'HH requires a phone, but it is absent from the CV, Noco and existing HH resumes.',
        'fill_resume')
    }
    if (!currentPhone && structuredPhone) await phoneInput.fill(structuredPhone)
  }
  await fill(page, profile.cv.contacts.email, ['Электронная почта', 'Email'],
    ['input[type="email"]', 'input[name="email"]'])
  const preferred = await field(page, ['Предпочтительный способ связи', 'Preferred contact'])
  if (preferred) await setPreferredEmail(page)
  const travel = await firstVisible([page.getByText(/командиров|business trip/i)])
  if (travel) await setWorkPreferences(page, profile.client.market)
  await nextWizardStep(page, 'personal information', { area: profile.cv.location })

  // HH can replace the temporary profession-step ID with the persisted resume
  // ID after saving personal information. The education screen exposes the
  // persisted ID as the name of the resume propagation checkbox.
  const persistedResumeCheckbox = page.getByLabel(targetTitle, { exact: true })
  const persistedResumeId = await persistedResumeCheckbox.count()
    ? String(await persistedResumeCheckbox.first().getAttribute('name', { timeout: 1000 })
      .catch(() => '') ?? '')
    : ''
  if (/^[a-z0-9]+$/i.test(persistedResumeId)) {
    activeDraftId = persistedResumeId
    if (resumable) resumable = { ...resumable, id: persistedResumeId,
      href: `https://hh.ru/profile/resume/educations?resume=${persistedResumeId}` }
  }

  for (const item of profile.cv.education) {
    const educationCards = page.locator(
      '[data-qa*="resume-profile-screen_educations"]:visible label[data-qa="cell"]:visible')
    const cardTexts = await educationCards.allInnerTexts()
    const alreadyPresent = cardTexts.length
      ? cardTexts.some(text => educationCardMatches(text, item))
      : await page.getByText(item.institution, { exact: false }).first().isVisible().catch(() => false)
    if (!alreadyPresent) {
      const educationWizardUrl = page.url()
      const selectionScreen = page.locator(
        '[data-qa*="resume-profile-screen_educations"]:visible label[data-qa="cell"]:visible')
      if (await selectionScreen.count()) {
        await page.goto('https://hh.ru/profile/block/educations', {
          waitUntil: 'domcontentloaded', timeout: 120_000
        })
        const add = await firstVisible([
          page.locator('[data-qa="profile-educations-add"]:visible'),
          page.getByRole('button', { name: /^Добавить$/i })
        ])
        if (!add) throw profileFillerError('profile_hh_education_control_missing',
          'HH add-education control was not found.', 'fill_resume')
        await add.click()
        await page.waitForURL(url => /\/profile\/edit\/primaryEducation/i.test(url.pathname), {
          timeout: 15_000
        }).catch(() => undefined)
        if (!(await addEducation(page, item, activeDraftId))) throw profileFillerError(
          'profile_hh_education_control_missing', 'HH education editor was not found.', 'fill_resume')
        await page.goto(educationWizardUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      } else if (!(await addEducation(page, item, activeDraftId))) {
        throw profileFillerError('profile_hh_education_control_missing',
          'HH add-education control was not found.', 'fill_resume')
      }
    }
  }
  await syncResumeEducationSelection(page, profile.cv.education)
  await nextWizardStep(page, 'education')

  await addSkills(page, orderedSkillCandidates(profile.cv))
  await nextWizardStep(page, 'skills')
  if (!activeDraftId) throw profileFillerError('profile_hh_resume_not_created',
    'No draft ID is available for skill verification.', 'fill_skills')
  await syncStrictSkills(page, profile, { id: activeDraftId, title: targetTitle,
    href: `https://hh.ru/resume/${activeDraftId}`, isDraft: true })

  if (!activeDraftId) throw profileFillerError('profile_hh_resume_not_created',
    'HH draft ID is unavailable before safe experience editing.', 'fill_resume')
  const experienceUrl = `https://hh.ru/profile/resume/experience?resume=${encodeURIComponent(activeDraftId)}`
  const publishedHostId = before.find(item => !item.isDraft)?.id
  await page.goto(experienceUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForTimeout(1500)
  for (const item of profile.cv.experience) {
    if (!(await hasResumeExperienceCard(page, item)) &&
        !(await addDraftExperienceThroughProfile(page, item, activeDraftId, artifactDir,
          publishedHostId))) throw profileFillerError(
      'profile_hh_experience_control_missing', 'HH add-experience control was not found.', 'fill_resume')
    await page.goto(experienceUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(700)
  }
  await syncResumeExperienceSelection(page, profile.cv.experience)
  await page.goto(experienceUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForTimeout(700)
  await syncResumeExperienceSelection(page, profile.cv.experience, true)
  if (process.env.PROFILE_FILLER_INSPECT_FINAL_STEP === '1') {
    const diagnostic = path.join(artifactDir, 'final-wizard-step.png')
    await captureArtifactScreenshot(page, diagnostic)
    throw profileFillerError('profile_hh_final_step_inspection',
      `HH final wizard step captured at ${diagnostic}.`, 'fill_resume')
  }
  // Do not advance from experience: the current HH wizard publishes immediately.
  // Any later optional sections must be edited through safe partial-edit routes.
  await captureArtifactScreenshot(page, path.join(artifactDir,
    `created-${title.replace(/[^a-zа-я0-9]+/gi, '-').slice(0, 60)}.png`))
  const after = await listResumes(page)
  const beforeIds = new Set(before.map(item => item.id))
  const knownDraft = activeDraftId ? {
    id: activeDraftId,
    title: profession,
    href: `https://hh.ru/resume/${activeDraftId}`,
    statusText: 'incomplete',
    isDraft: true
  } : undefined
  const created = resumable ? { ...resumable, href: `https://hh.ru/resume/${resumable.id}` } :
    after.find(item => !beforeIds.has(item.id)) ?? knownDraft ??
    after.find(item => item.title.trim() === title.trim() &&
      !before.some(old => old.id === item.id && old.title.trim() === title.trim()))
  if (!created) {
    throw profileFillerError('profile_hh_resume_not_created',
      `HH did not expose a new draft for title "${title}".`, 'create_resume')
  }
  if (!created.isDraft) {
    throw profileFillerError('profile_hh_unexpected_publication',
      `New resume ${created.id} is not marked as a draft.`, 'verify_draft')
  }
  await page.goto(created.href, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await fillSupplemental(page, profile, title)
  await page.goto(`https://hh.ru/resume/${created.id}`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  const actualTitle = String(await page.locator('[data-qa="resume-block-title-position"]')
    .innerText().catch(() => '')).trim()
  const statusText = String(await page.locator('body').innerText().catch(() => '')).trim()
  const updated = { ...created, href: `https://hh.ru/resume/${created.id}`,
    title: actualTitle || created.title, statusText, isDraft: created.isDraft }
  if (!updated.isDraft) throw profileFillerError('profile_hh_unexpected_publication',
    `Resume ${created.id} stopped being a draft after editing.`, 'verify_draft')
  if (updated.title.trim() !== targetTitle.trim()) {
    throw profileFillerError('profile_hh_title_verification_failed',
      `HH draft title does not match the requested title "${targetTitle}".`, 'verify_draft')
  }
  return updated
}

export async function duplicateResumeVariant(page: Page, source: ResumeSnapshot,
  title: string, _stack: string, market: 'Ru' | 'En',
  recovery: { artifactDir?: string; duplicateId?: string } = {}): Promise<ResumeSnapshot> {
  const recordCreated = (id: string) => {
    if (recovery.artifactDir) fs.writeFileSync(path.join(recovery.artifactDir,
      `duplicate-${id}.json`), `${JSON.stringify({ sourceId: source.id, targetTitle: title,
      duplicateId: id, stage: 'created' }, null, 2)}\n`, { mode: 0o600 })
  }
  const duplicatedId = recovery.duplicateId ?? await requestNativeResumeClone(page, source.id, recordCreated)
  if (!/^[a-z0-9]+$/i.test(duplicatedId) || duplicatedId === source.id) throw profileFillerError(
    'profile_hh_duplicate_not_created', 'Duplicate ID must differ from its source.', 'duplicate_resume')
  const targetTitle = professionForTitle(title, market)
  // Native clone retains specialization/content but clears its title. The wizard's
  // next button can publish; the partial position editor saves only the title.
  await page.goto(`https://hh.ru/resume/edit/${duplicatedId}/position`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  const titleInput = page.locator('[data-qa="resume-edit-title-suggest"]:visible').first()
  await titleInput.waitFor({ state: 'visible', timeout: 10_000 })
  const matches = (await titleInput.inputValue()).trim() === targetTitle.trim()
  if (!matches) await fill(page, targetTitle, ['Профессия', 'Position', 'Resume title'], [
    '[data-qa="resume-edit-title-suggest"]', 'input[name="title"]',
    '[data-qa="resume-block-title-position"] input', '[data-qa*="title"] input'
  ], true)
  if (!matches) await saveChangesWithoutPublishing(page)
  return await verifyKnownDraft(page, targetTitle, duplicatedId, recovery.artifactDir)
}

// A native copy can have a title but still require the profession-choice screen.
// Only called during authorized activation after content/privacy verification.
export async function completeKnownResumeProfession(page: Page, resume: ResumeSnapshot): Promise<void> {
  if (resumeId(page.url()) !== resume.id ||
      new URL(page.url()).pathname !== '/profile/resume/professional_role') throw profileFillerError(
    'profile_hh_activation_identity_mismatch', 'Profession completion requires the exact known resume wizard.',
    'activate_resume')
  const input = await openProfessionEditor(page)
  if ((await input.inputValue()).trim() !== INITIAL_HH_PROFESSION) await input.fill(INITIAL_HH_PROFESSION)
  if (!(await chooseFirstSuggestion(page, INITIAL_HH_PROFESSION))) throw profileFillerError(
    'profile_hh_profession_suggestion_missing', 'HH did not offer the required programmer profession.', 'activate_resume')
  // A popular profession radio does not automatically open specialization.
  // Its first Continue opens that mandatory sheet; only the sheet submit saves.
  await openSpecializationPicker(page)
  if (!(await selectRequiredSpecialization(page, '', 'Ru'))) throw profileFillerError(
    'profile_hh_specialization_missing', 'HH specialization was not confirmed.', 'activate_resume')
  await page.waitForURL(url => url.pathname !== '/profile/resume/professional_role', {
    timeout: 10_000
  }).catch(() => undefined)
  if (new URL(page.url()).pathname === '/profile/resume/professional_role') {
    if (resumeId(page.url()) !== resume.id) throw profileFillerError(
      'profile_hh_activation_identity_mismatch', 'HH changed the resume ID while confirming profession.', 'activate_resume')
    const next = page.locator('[data-qa="resume-profile-next-screen"]:visible').first()
    await next.waitFor({ state: 'visible', timeout: 10_000 })
    await next.click()
    await page.waitForURL(url => url.pathname !== '/profile/resume/professional_role', {
      timeout: 20_000
    }).catch(() => undefined)
    if (new URL(page.url()).pathname === '/profile/resume/professional_role') throw profileFillerError(
      'profile_hh_activation_profession_stalled', 'HH did not save the confirmed profession.', 'activate_resume')
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  await page.goto(`https://hh.ru/resume/edit/${resume.id}/position`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  const titleInput = page.locator('[data-qa="resume-edit-title-suggest"]:visible').first()
  await titleInput.waitFor({ state: 'visible', timeout: 10_000 })
  if ((await titleInput.inputValue()).trim() !== resume.title.trim()) {
    await titleInput.fill(resume.title)
    await saveChangesWithoutPublishing(page)
  }
}

async function resumeCard(page: Page, id: string): Promise<Locator | undefined> {
  const link = page.locator([
    `a[data-qa="resume-card-link-${id}"]`,
    `a[href*="/resume/${id}"]`,
    `a[href*="resume=${id}"]`
  ].join(',')).first()
  if (!(await link.count())) return undefined
  const resumeRoot = link.locator('xpath=ancestor::*[@data-qa="resume"][1]')
  if (await resumeRoot.count()) return resumeRoot.first()
  const actionRoot = link.locator(
    'xpath=ancestor::*[.//*[@data-qa="resume-list-action-more"]][1]')
  return await actionRoot.count() ? actionRoot.first() :
    link.locator('xpath=ancestor::*[self::div or self::article][1]')
}

export async function deleteResume(page: Page, resume: ResumeSnapshot): Promise<void> {
  await page.goto(HH_RESUMES_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const directResumeId = new URL(page.url()).pathname.match(/^\/resume\/([a-z0-9]+)\/?$/i)?.[1]
  let deleteControl: Locator | undefined
  let card: Locator | undefined
  if (directResumeId) {
    // The compact profile route can update the URL to /resume/<id> before the
    // direct resume action menu is hydrated. Reload the exact, already verified
    // target URL so the menu click cannot be swallowed by that transition.
    await page.goto(resume.href, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForFunction(() => Boolean(document.body?.innerText.trim().length),
      undefined, { timeout: 15_000 }).catch(() => undefined)
    await page.waitForTimeout(1500)
    const hydratedResumeId = new URL(page.url()).pathname
      .match(/^\/resume\/([a-z0-9]+)\/?$/i)?.[1]
    const normalizedExpectedTitle = resume.title.toLocaleLowerCase('ru-RU')
    const titleMatches = (await page.title()).toLocaleLowerCase('ru-RU')
      .includes(normalizedExpectedTitle) ||
      await page.getByText(resume.title, { exact: true }).isVisible().catch(() => false)
    if (hydratedResumeId !== resume.id || !titleMatches) {
      throw profileFillerError('profile_hh_delete_target_mismatch',
        `HH opened a different resume before deleting ${resume.id}.`, 'delete_old_resumes', {
          expectedResumeId: resume.id,
          actualResumeId: hydratedResumeId,
          expectedTitle: resume.title,
          actualPageTitle: await page.title()
        })
    }
    const download = page.locator('[data-qa="resume-download-button"]:visible')
    const menu = download.locator('xpath=following::button[1]')
    if (!(await download.count()) || !(await menu.isVisible().catch(() => false))) {
      throw profileFillerError('profile_hh_delete_unavailable',
        `Action menu was not found for old resume ${resume.id}.`, 'delete_old_resumes')
    }
    for (let attempt = 0; attempt < 2 && !deleteControl; attempt += 1) {
      await menu.click({ force: attempt > 0 })
      for (let settle = 0; settle < 10 && !deleteControl; settle += 1) {
        deleteControl = await firstVisible([
          page.getByText(/^(?:Удалить|Delete)$/i, { exact: true })
        ])
        if (!deleteControl) await page.waitForTimeout(200)
      }
    }
  } else {
    card = await resumeCard(page, resume.id)
    const targetLink = page.locator([
      `a[data-qa="resume-card-link-${resume.id}"]`,
      `a[href*="/resume/${resume.id}"]`,
      `a[href*="resume=${resume.id}"]`
    ].join(',')).first()
    if (!(await targetLink.count()) || !card) throw profileFillerError(
      'profile_hh_delete_unavailable',
      `Resume card was not found for old resume ${resume.id}.`, 'delete_old_resumes')
    deleteControl = await firstVisible([
      card.getByRole('button', { name: /^(?:Удалить|Delete)$/i }),
      card.getByRole('link', { name: /^(?:Удалить|Delete)$/i }),
      card.getByText(/^(?:Удалить|Delete)$/i, { exact: true })
    ])
  }
  if (!deleteControl && card) {
    const menu = await firstVisible([
      card.locator('[data-qa="resume-list-action-more"]'),
      card.locator('[data-qa*="menu"]'),
      card.getByRole('button', { name: /ещё|more|actions/i })
    ])
    if (!menu) {
      const state = await page.evaluate(() => ({
        links: [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
          .map(item => item.getAttribute('href')).filter(Boolean).slice(0, 20),
        actions: [...document.querySelectorAll<HTMLElement>('button, a')]
          .map(item => String(item.innerText ?? '').trim()).filter(Boolean).slice(0, 40)
      })).catch(() => ({ links: [], actions: [] }))
      throw profileFillerError('profile_hh_delete_unavailable',
        `Delete action was not found for old resume ${resume.id}.`, 'delete_old_resumes', state)
    }
    await menu.click()
    await page.waitForTimeout(300)
    deleteControl = await firstVisible([
      page.locator('[role="menu"]:visible')
        .getByText(/^(?:Удалить резюме|Удалить|Delete resume|Delete)$/i),
      page.locator('[data-qa="bottom-sheet-css-variables"]:visible')
        .getByText(/^(?:Удалить резюме|Удалить|Delete resume|Delete)$/i),
      page.locator('[role="dialog"]:visible')
        .getByText(/^(?:Удалить резюме|Удалить|Delete resume|Delete)$/i),
      page.getByText(/^(?:Удалить резюме|Delete resume)$/i).last()
    ])
  }
  if (!deleteControl) {
    const editControl = await firstVisible([
      page.locator('[role="menu"]:visible')
        .getByText(/^(?:Редактировать|Edit)$/i),
      page.locator('[data-qa="bottom-sheet-css-variables"]:visible')
        .getByText(/^(?:Редактировать|Edit)$/i),
      page.getByText(/^(?:Редактировать|Edit)$/i).last()
    ])
    if (editControl) {
      await editControl.click()
      await page.waitForTimeout(800)
      deleteControl = await firstVisible([
        page.locator('[data-qa*="resume-delete"]:visible'),
        page.getByRole('button', { name: /^(?:Удалить резюме|Delete resume)$/i }),
        page.getByRole('link', { name: /^(?:Удалить резюме|Delete resume)$/i }),
        page.getByText(/^(?:Удалить резюме|Delete resume)$/i)
      ])
    }
  }
  if (!deleteControl) {
    throw profileFillerError('profile_hh_delete_unavailable',
      `Delete control was not found for old resume ${resume.id}.`, 'delete_old_resumes')
  } else {
    await deleteControl.click()
  }
  const confirmation = await firstVisible([
    page.locator('[role="dialog"]:visible').getByRole('button', {
      name: /^(?:Удалить навсегда|Удалить|Подтвердить|Delete permanently|Delete|Confirm)$/i
    }),
    page.locator('[data-qa="bottom-sheet-css-variables"]:visible').getByRole('button', {
      name: /^(?:Удалить навсегда|Удалить|Подтвердить|Delete permanently|Delete|Confirm)$/i
    })
  ])
  let scopedConfirmation = confirmation
  if (!scopedConfirmation) {
    const prompt = await firstVisible([
      page.getByText(/(?:Вы уверены.*)?удалить\s+резюме|Are you sure.*delete.*resume/i)
    ])
    if (prompt) {
      const owners = prompt.locator(
        'xpath=ancestor-or-self::*[self::div or self::section or self::article]')
      for (let index = (await owners.count()) - 1;
        index >= 0 && !scopedConfirmation; index -= 1) {
        const owner = owners.nth(index)
        const text = String(await owner.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        if (!/удалить\s+резюме|delete.*resume/i.test(text) || text.length > 500) continue
        scopedConfirmation = await firstVisible([
          owner.getByRole('button', { name: /^(?:Удалить|Delete)$/i }),
          owner.getByRole('link', { name: /^(?:Удалить|Delete)$/i }),
          owner.getByText(/^(?:Удалить|Delete)$/i, { exact: true })
        ])
      }
    }
  }
  if (!scopedConfirmation) throw profileFillerError('profile_hh_delete_confirmation_missing',
    `Delete confirmation was not found for old resume ${resume.id}.`, 'delete_old_resumes')
  await scopedConfirmation.click()
  await page.waitForTimeout(700)
}

async function openPrivacyEditor(page: Page, resumeIdValue: string): Promise<void> {
  const url = `https://hh.ru/resume/edit/${resumeIdValue}/visibility`
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      .catch(() => undefined)
    const hydrated = await page.waitForFunction(() =>
      Boolean(document.body?.innerText.trim().length), undefined, { timeout: 15_000 })
      .then(() => true).catch(() => false)
    if (hydrated) return
    await page.waitForTimeout(1_000)
  }
  throw profileFillerError('profile_hh_visibility_page_empty',
    'HH visibility editor stayed empty after three bounded reloads.', 'configure_privacy')
}

export async function configurePrivacyAndStopList(page: Page, resume: ResumeSnapshot,
  profile: PreparedProfile): Promise<ResumePrivacyVerification> {
  await openPrivacyControls(page, resume.id)
  await configurePrivacyBase(page)
  await savePrivacyEditor(page)
  // Base switches never edit employer selections; the list becomes accessible after choosing blacklist.
  await rememberSelectedEmployers(page, resume.id, profile.operationId)

  let attempted: EmployerSelectionOutcome[]
  try {
    attempted = await applyEmployerCandidatesOneAtATime(profile.employerCandidates, {
      async inspect(candidate) {
        const result = await inspectEmployerCandidate(page, resume.id, candidate)
        return result.status === 'selected' || result.status === 'unselected'
          ? { status: result.status, officialName: result.officialName }
          : result
      },
      async selectAndSave(candidate, officialName) {
        const result = await inspectEmployerCandidate(page, resume.id, candidate)
        if (result.status !== 'unselected' || result.officialName !== officialName) {
          throw new EmployerSelectionNotPersistedError(candidate.name, officialName)
        }
        await result.row.click()
        await confirmEmployerSheets(page)
        await savePrivacyEditor(page)
      }
    })
  } catch (error) {
    if (error instanceof EmployerSelectionNotPersistedError) {
      throw profileFillerError('profile_hh_employer_selection_not_persisted',
        `HH did not persist employer "${error.officialName}" for resume ${resume.id}.`,
        'verify_privacy')
    }
    throw error
  }
  const addedKeys = new Set(attempted.filter(item => item.status === 'added')
    .map(item => employerNameKey(item.candidate)))

  const verification = await inspectPrivacyAndStopList(page, resume, profile)
  verification.employers = verification.employers.map(outcome =>
    outcome.status === 'existing' && addedKeys.has(employerNameKey(outcome.candidate))
      ? { ...outcome, status: 'added' }
      : outcome)
  if (profile.employerCandidates.length &&
      verification.employers.length !== profile.employerCandidates.length) {
    throw profileFillerError('profile_hh_stop_list_accounting_incomplete',
      `HH stop-list accounting is incomplete for resume ${resume.id}.`, 'verify_privacy')
  }
  await verifyEmployerPreview(page, resume.id, profile)
  return verification
}

async function openPrivacyControls(page: Page, resumeIdValue: string): Promise<void> {
  // Draft list links reopen the unfinished wizard and do not expose visibility.
  // Privacy is a safe partial editor and must be addressed directly by resume ID.
  await openPrivacyEditor(page, resumeIdValue)
  const visibilityCard = await firstVisible([
    page.locator('[data-qa="resume-visibility-card"]'),
    page.getByText(/видимость резюме|resume visibility|изменить видимость/i)
  ])
  if (!visibilityCard) throw profileFillerError('profile_hh_control_missing',
    'HH resume visibility control was not found.', 'configure_privacy')
  await visibilityCard.click()
  await page.waitForTimeout(500)
}

async function configurePrivacyBase(page: Page): Promise<void> {
  const blacklist = await firstVisible([
    page.locator('[data-qa="resume-visibility-card-access-type-blacklist"]'),
    page.getByText(/скрыто от.*выбранных работодател|visible to everyone.*except/i)
  ])
  if (!blacklist) throw profileFillerError('profile_hh_control_missing',
    'HH employer blacklist visibility option was not found.', 'configure_privacy')
  if (!(await blacklist.locator('input').first().isChecked().catch(() => false))) await blacklist.click()

  const anonymousText = await firstVisible([
    page.getByText(/анонимное резюме|anonymous resume/i)
  ])
  if (!anonymousText) throw profileFillerError('profile_hh_phone_privacy_missing',
    'HH anonymous-resume control was not found.', 'configure_privacy')
  const anonymousCell = anonymousText.locator('xpath=ancestor::*[@data-qa="cell"][1]')
  const anonymousSwitch = anonymousCell.getByRole('switch')
  if (!(await anonymousSwitch.isVisible().catch(() => false))) {
    throw profileFillerError('profile_hh_phone_privacy_missing',
      'HH anonymous-resume switch was not found.', 'configure_privacy')
  }
  if (await anonymousSwitch.getAttribute('aria-checked') !== 'true') await anonymousSwitch.click()

  const hiddenFields: Array<[string, boolean]> = [
    ['names_and_photo', false], ['phones', true], ['email', false],
    ['other_contacts', false], ['experience', false]
  ]
  for (const [fieldName, checked] of hiddenFields) {
    const label = page.locator(
      `[data-qa="resume-visibility-card-hidden-fields-${fieldName}"]:visible`).first()
    const input = label.locator('input[type="checkbox"]').first()
    if (!(await label.isVisible().catch(() => false)) || !(await input.count())) {
      if (fieldName === 'phones') throw profileFillerError('profile_hh_phone_privacy_missing',
        'HH hide-phone privacy control was not found.', 'configure_privacy')
      continue
    }
    if (await input.isChecked().catch(() => !checked) !== checked) await label.click()
  }
}

async function savePrivacyEditor(page: Page): Promise<void> {
  const save = await firstVisible([
    page.locator('[data-qa="resume-partial-edit-save"]'),
    page.getByText(/^сохранить$|^save$/i)
  ])
  if (!save) throw profileFillerError('profile_hh_safe_save_missing',
    'HH privacy save control was not found.', 'configure_privacy')
  await save.click()
  await page.waitForTimeout(700)
}

async function confirmEmployerSheets(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const modalSave = await firstVisible([
      page.locator('[data-qa="resume-modal-button-save"]'),
      page.locator('[data-qa="bottom-sheet-content"]:visible, ' +
        '[data-qa="bottom-sheet-css-variables"]:visible')
        .getByText(/^готово$|^добавить$|^done$|^add$/i)
    ])
    if (!modalSave) break
    await modalSave.click()
    await page.waitForTimeout(500)
  }
  if (await firstVisible([page.locator('[data-qa="resume-modal-button-save"]')])) {
    throw profileFillerError('profile_hh_bottom_sheet_blocked',
      'HH did not close the employer-list editor after confirmation.', 'configure_privacy')
  }
}

type EmployerInspection =
  | { status: 'selected' | 'unselected'; officialName: string; row: Locator }
  | { status: 'skipped'; reason: 'not_found' | 'ambiguous' | 'employer_search_unavailable' }

function officialEmployerName(text: string): string {
  return text.split(/\r?\n/).map(item => item.trim()).find(Boolean) ?? ''
}

async function inspectEmployerCandidate(page: Page, resumeIdValue: string,
  candidate: EmployerCandidate): Promise<EmployerInspection> {
  await openPrivacyControls(page, resumeIdValue)
  const employerActivator = await firstVisible([
    page.locator('[data-qa="applicant-employers-list-activator-blacklist"]')
  ])
  if (!employerActivator) throw profileFillerError('profile_hh_employer_search_unavailable',
    'Employer search is unavailable.', 'configure_privacy')
  await employerActivator.click()
  const search = await field(page,
    ['Найти работодателя', 'Find employer', 'Search employer', 'Поиск по названию'], [
      '[data-qa="resume-editor-employer-list-search-input"]',
      '[data-qa*="employer"] input', 'input[type="search"]'
    ])
  if (!search) throw profileFillerError('profile_hh_employer_search_unavailable',
    'Employer search input is unavailable.', 'configure_privacy')
  await search.fill(candidate.name)
  await page.waitForTimeout(800)
  const rows = page.locator('label[data-qa="cell"]:visible')
    .filter({ has: page.locator('input[type="checkbox"]') })
  const options: Array<{ row: Locator; text: string; officialName: string }> = []
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index)
    const rawText = String(await row.innerText().catch(() => '')).trim()
    const text = rawText.replace(/\s+/g, ' ').trim()
    if (!text || /фио|телефон|электронн|другие контакты|места работы/i.test(text)) continue
    options.push({ row, text, officialName: officialEmployerName(rawText) })
  }
  const matches = resolveOfficialEmployerOptions(candidate.name, options)
  if (matches.length !== 1) {
    return { status: 'skipped', reason: options.length ? 'ambiguous' : 'not_found' }
  }
  const match = options.find(option => option.officialName === matches[0].officialName &&
    option.text === matches[0].text)
  if (!match) return { status: 'skipped', reason: 'not_found' }
  const checked = await match.row.locator('input[type="checkbox"]').first()
    .isChecked().catch(() => false)
  return { status: checked ? 'selected' : 'unselected',
    officialName: match.officialName, row: match.row }
}

const selectedEmployersBefore = new WeakMap<Page, Map<string, string[]>>()

async function readSelectedEmployers(page: Page, id: string): Promise<string[]> {
  await openPrivacyControls(page, id)
  const activator = page.locator('[data-qa="applicant-employers-list-activator-blacklist"]')
  if (!(await activator.isVisible().catch(() => false))) throw profileFillerError(
    'profile_hh_employer_search_unavailable', 'Cannot inspect the saved employer list.', 'verify_privacy')
  await activator.click()
  const search = page.locator('[data-qa="resume-editor-employer-list-search-input"]')
  if (!(await search.isVisible().catch(() => false))) throw profileFillerError(
    'profile_hh_employer_search_unavailable', 'Cannot inspect the saved employer list.', 'verify_privacy')
  if (await search.inputValue()) await search.fill('')
  const entries = page.locator('label[data-qa="cell"]:visible input[type="checkbox"]')
  if (!(await entries.count())) throw profileFillerError('profile_hh_employer_list_unreadable',
    'The saved employer list cannot be inspected; an empty search is not proof of no exclusions.', 'verify_privacy')
  return await page.locator('label[data-qa="cell"]:visible:has(input[type="checkbox"]:checked)')
    .evaluateAll(elements => elements.map(element => String(element.textContent ?? '').split('\n')
      .map(text => text.trim()).find(Boolean) ?? '').filter(Boolean))
}

async function rememberSelectedEmployers(page: Page, id: string, operationId?: string): Promise<string[]> {
  const map = selectedEmployersBefore.get(page) ?? new Map<string, string[]>()
  selectedEmployersBefore.set(page, map)
  if (!map.has(id)) {
    const current = await readSelectedEmployers(page, id)
    map.set(id, operationId ? preserveFirstObservation(operationId, id, 'employers', current) : current)
  }
  return map.get(id)!
}

export async function inspectPrivacyAndStopList(page: Page, resume: ResumeSnapshot,
  profile: PreparedProfile): Promise<ResumePrivacyVerification> {
  await openPrivacyControls(page, resume.id)
  const savedBlacklist = page.locator(
    '[data-qa="resume-visibility-card-access-type-blacklist"] input').first()
  const savedPhone = page.locator(
    '[data-qa="resume-visibility-card-hidden-fields-phones"] input').first()
  const blacklist = await savedBlacklist.isChecked().catch(() => false)
  const hiddenPhones = await savedPhone.isChecked().catch(() => false)
  if (!blacklist) return { resumeId: resume.id, blacklist, hiddenPhones,
    anonymous: false, otherFieldsVisible: false, preservedEmployers: false, employers: [] }
  const anonymousText = page.getByText(/^(?:Анонимное резюме|Anonymous resume)$/i).first()
  const anonymous = await anonymousText.locator('xpath=ancestor::*[@data-qa="cell"][1]')
    .getByRole('switch').getAttribute('aria-checked').catch(() => '') === 'true'
  let otherFieldsVisible = true
  for (const name of ['names_and_photo', 'email', 'other_contacts', 'experience']) {
    const input = page.locator(`[data-qa="resume-visibility-card-hidden-fields-${name}"] input`).first()
    otherFieldsVisible &&= Boolean(await input.count()) && !(await input.isChecked().catch(() => true))
  }
  let preservedEmployers = true
  const previousEmployers = await rememberSelectedEmployers(page, resume.id, profile.operationId)
  for (const name of previousEmployers) {
    const state = await inspectEmployerCandidate(page, resume.id, { name, sources: ['existing-hh'] })
    preservedEmployers &&= state.status === 'selected'
  }
  const employers: EmployerSelectionOutcome[] = []
  for (const candidate of profile.employerCandidates) {
    const inspected = await inspectEmployerCandidate(page, resume.id, candidate)
    if (inspected.status === 'selected') {
      employers.push({ candidate: candidate.name, sources: candidate.sources,
        status: 'existing', officialName: inspected.officialName })
    } else if (inspected.status === 'unselected') {
      employers.push({ candidate: candidate.name, sources: candidate.sources,
        status: 'skipped', officialName: inspected.officialName, reason: 'not_selected' })
    } else {
      employers.push({ candidate: candidate.name, sources: candidate.sources,
        status: 'skipped', reason: 'reason' in inspected
          ? inspected.reason : 'employer_search_unavailable' })
    }
  }
  return {
    resumeId: resume.id,
    blacklist, hiddenPhones, anonymous, otherFieldsVisible, preservedEmployers,
    employers
  }
}

async function verifyEmployerPreview(page: Page, resumeIdValue: string,
  profile: PreparedProfile): Promise<void> {
  await openPrivacyControls(page, resumeIdValue)
  const beforePages = page.context().pages()
  const previewOpened = await clickText(page, [/как видят работодатели/i, /view as employer/i])
  if (!previewOpened) return
  await page.waitForTimeout(700)
  const preview = page.context().pages().find(item => !beforePages.includes(item)) ?? page
  await installHhCookieConsentHandler(preview)
  const structuredPhone = await firstVisible([
    preview.locator('[data-qa*="phone"], [data-qa*="contact-phone"]')
  ])
  if (structuredPhone) {
    throw profileFillerError('profile_hh_phone_visible',
      'A structured phone field is visible in employer preview.', 'verify_privacy')
  }
  if (profile.cv.contacts.phone &&
    !(await preview.locator('body').innerText()).includes(profile.cv.contacts.phone)) {
    throw profileFillerError('profile_hh_about_phone_missing',
      'The About phone is missing from employer preview.', 'verify_privacy')
  }
  if (preview !== page) await preview.close().catch(() => undefined)
}

export async function verifyResumeContract(page: Page, profile: PreparedProfile,
  resume: ResumeSnapshot, expectedTitle: string,
  artifactDir: string): Promise<ResumeContractVerification> {
  const verification = await readResumeContract(page, profile, resume, expectedTitle, {
    async publication() {
      const state = await readResumePublication(page, resume)
      return resume.isDraft ? state.isDraft : state.isActive && state.searchable && !state.isDraft
    },
    async resumeLanguage() {
      const state = await readResumePublication(page, resume)
      return state.resumeLanguage === 'EN' ? 'en' : state.resumeLanguage === 'RU' ? 'ru' : 'unknown'
    },
    privacy: () => inspectPrivacyAndStopList(page, resume, profile),
    workPreferences: () => verifyWorkPreferences(page),
    async permits() { await setExactWorkPermits(page, true) },
    async languages() {
      for (const item of profile.cv.languages) if (!(await hasProfileLanguage(page, item))) return false
      return profile.cv.languages.some(item => /english|английский/i.test(item.name))
    },
    async experienceMembership() {
      if (!resume.isDraft) return true
      await page.goto(`https://hh.ru/profile/resume/experience?resume=${encodeURIComponent(resume.id)}`,
        { waitUntil: 'domcontentloaded', timeout: 120_000 })
      return await syncResumeExperienceSelection(page, profile.cv.experience, true)
    },
    async educationMembership() {
      if (!resume.isDraft || !profile.cv.education.length) return true
      await page.goto(`https://hh.ru/profile/resume/educations?resume=${encodeURIComponent(resume.id)}`,
        { waitUntil: 'domcontentloaded', timeout: 120_000 })
      return await syncResumeEducationSelection(page, profile.cv.education, true)
    },
    skills: () => readPersistedSkills(page, resume.id)
  })
  fs.writeFileSync(path.join(artifactDir, `verified-contract-${resume.id}.json`),
    JSON.stringify(verification, null, 2), { mode: 0o600 })
  return verification
}

export async function completeExistingResume(page: Page, profile: PreparedProfile,
  title: string, resume: ResumeSnapshot, artifactDir: string): Promise<ResumeSnapshot> {
  if (resume.isDraft) return await createResumeDraft(page, profile, title, artifactDir, resume.id)
  await fillPublishedResumeCore(page, profile, resume)
  await page.goto('https://hh.ru/profile/edit/common', { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await fill(page, profile.cv.firstName, ['Имя', 'First name'], ['input[name="firstName"]'], true)
  await fill(page, profile.cv.lastName, ['Фамилия', 'Last name'], ['input[name="lastName"]'], true)
  await fill(page, profile.cv.middleName, ['Отчество', 'Middle name'], ['input[name="middleName"]'])
  await fillBirthDate(page, profile.cv.birthDate)
  await setArea(page, profile.cv.location)
  await saveChangesWithoutPublishing(page)
  for (const item of profile.cv.education) {
    await page.goto('https://hh.ru/profile/block/educations', { waitUntil: 'domcontentloaded', timeout: 120_000 })
    if (await page.getByText(item.institution, { exact: false }).first().isVisible().catch(() => false)) continue
    const add = await firstVisible([page.locator('[data-qa="profile-educations-add"]:visible'),
      page.getByRole('button', { name: /^Добавить$/i })])
    if (!add) throw profileFillerError('profile_hh_education_control_missing',
      'The education Add action is unavailable.', 'fill_resume')
    await add.click()
    if (!(await addEducation(page, item, resume.id))) throw profileFillerError('profile_hh_education_control_missing',
      'The education editor is unavailable.', 'fill_resume')
  }
  await page.goto(resume.href, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await fillSupplemental(page, profile, title)
  const updated = { ...resume, title: professionForTitle(title, profile.client.market) }
  await syncStrictSkills(page, profile, updated)
  return updated
}

// Compatibility for the manual-completion DOM regression suite.
export const dismissStaleContactsPrompt = dismissStaleResumeContactsPrompt

async function birthDateControlValue(control: Locator): Promise<string> {
  return String(await control.getAttribute('data-value').catch(() => '') ||
    await control.locator('input').first().inputValue({ timeout: 500 }).catch(() => '') ||
    await control.innerText().catch(() => '')).trim()
}


export function assertNewResumeEntry(url: string): void {
  const route = new URL(url)
  if (/^\/profile\/resume\//.test(route.pathname) &&
      route.pathname !== '/profile/resume/professional_role') {
    throw profileFillerError('profile_hh_new_resume_redirected',
      'HH redirected new-resume creation to an existing unfinished wizard. Preserve that draft and inspect native duplication before continuing.',
      'create_resume')
  }
}
