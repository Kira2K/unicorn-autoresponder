import fs from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from 'playwright'
import { profileFillerError } from './errors.ts'
import type { CvEducation, CvExperience, CvLanguage, PreparedProfile } from './types.ts'

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
    const count = await page.locator('[data-qa="bottom-sheet-css-variables"]:visible').count()
    if (count > retain) {
      await page.keyboard.press('Escape').catch(() => undefined)
    }
  }
  if (await page.locator('[data-qa="bottom-sheet-css-variables"]:visible').count() > retain) {
    throw profileFillerError('profile_hh_bottom_sheet_blocked',
      'HH did not close an editor panel after preserving its value.', 'fill_resume')
  }
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

export async function listResumes(page: Page): Promise<ResumeSnapshot[]> {
  let activePage = page
  let freshPage: Page | undefined
  let ready = false
  for (let attempt = 0; attempt < 3 && !ready; attempt += 1) {
    if (attempt === 2) {
      freshPage = await page.context().newPage()
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
  // The current applicant profile hides incomplete resumes in the compact list
  // until any resume action menu is opened. Expanding it is read-only and lets
  // replacement/duplication verification see drafts as well as published cards.
  const compactTrigger = await firstVisible([
    activePage.locator('[data-qa="resume-list-action-more"]')
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

async function setArea(page: Page, value?: string) {
  if (!value) return
  const existing = await field(page, ['Город', 'City', 'Location'], [
    '[data-qa="profile-common-edit-area"]',
    '[data-qa="resume-block-personal-information-area"] input',
    'input[name="area"]'
  ])
  if (existing && String(await existing.inputValue().catch(() => '')).trim() === value.trim()) return
  const changed = await fill(page, value, ['Город', 'City', 'Location'], [
    '[data-qa="profile-common-edit-area"]',
    '[data-qa="resume-block-personal-information-area"] input',
    'input[name="area"]'
  ])
  if (!changed) return
  await page.waitForTimeout(700)
  const option = await firstVisible([
    page.locator('[role="option"]').filter({ hasText: value }),
    page.locator('[data-qa*="suggest"] li').filter({ hasText: value }),
    page.getByText(value, { exact: true })
  ])
  await option?.click().catch(() => undefined)
  await closeBottomSheets(page)
}

async function addPublishedExperience(page: Page, item: CvExperience): Promise<boolean> {
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

  // HH checks every resume by default. The first labelled checkbox is the
  // resume from which this editor was opened; clear all subsequent resumes.
  const resumeChecks = page.locator('input[type="checkbox"][aria-label]:checked')
  for (let index = 1; index < await resumeChecks.count(); index += 1) {
    const checkbox = resumeChecks.nth(index)
    await checkbox.locator('xpath=ancestor::label[1]').click({ force: true })
  }

  await company.fill(item.company)
  await page.waitForTimeout(500)
  const companySuggestion = await firstVisible([
    page.locator('[data-qa="suggest-item-cell"]:visible').filter({ hasText: item.company }),
    page.locator('[role="option"]:visible').filter({ hasText: item.company })
  ])
  if (companySuggestion) await companySuggestion.click()
  else {
    const editor = page.locator('[data-qa="bottom-sheet-container"]:visible input:visible').first()
    if (await editor.isVisible().catch(() => false)) await editor.press('Enter')
  }
  await closeBottomSheets(page)

  await position.fill(item.title)
  const positionEditor = page.locator('[data-qa="bottom-sheet-container"]:visible input:visible').first()
  if (await positionEditor.isVisible().catch(() => false)) {
    await positionEditor.press('Enter').catch(() => undefined)
  }
  await closeBottomSheets(page)
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
  await page.waitForTimeout(700)
  return true
}

async function addExperience(page: Page, item: CvExperience, currentResumeId?: string,
  artifactDir?: string) {
  const trace = (stage: string, details: Record<string, unknown> = {}) => {
    if (!artifactDir) return
    fs.appendFileSync(path.join(artifactDir, 'experience-state.ndjson'), `${JSON.stringify({
      at: new Date().toISOString(), stage, company: item.company,
      path: new URL(page.url()).pathname, ...details
    })}\n`, { mode: 0o600 })
  }
  const wizard = page.locator('[data-qa*="resume-profile-screen_experience"]:visible')
  const publishedEditor = /\/resume\/[a-z0-9]+\/experience/i.test(new URL(page.url()).pathname)
  if (publishedEditor) return await addPublishedExperience(page, item)
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
    const retainedSheets = itemSheet
      ? await page.locator('[data-qa="bottom-sheet-css-variables"]:visible').count()
      : 0
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

    const targetResumeId = resumeId(page.url()) || currentResumeId
    const propagation = await page.locator('input[type="checkbox"][name]:checked')
      .evaluateAll(inputs => inputs.map(input => input.getAttribute('name')).filter(Boolean) as string[])
    for (const name of propagation.filter(name => name !== targetResumeId)) {
      const checkbox = page.locator(`input[type="checkbox"][name="${name}"]:checked`).last()
      if (await checkbox.count()) await checkbox.locator('xpath=ancestor::label[1]').click({ force: true })
    }

    await company.fill(item.company)
    await page.waitForTimeout(400)
    const companySuggestion = await firstVisible([
      page.locator('[data-qa="suggest-item-cell"]:visible').filter({ hasText: item.company }),
      page.locator('[role="option"]:visible').filter({ hasText: item.company })
    ])
    if (companySuggestion) await companySuggestion.click()
    else {
      const companyEditor = page.locator('[data-qa="bottom-sheet-container"]:visible input:visible').first()
      if (await companyEditor.isVisible().catch(() => false)) await companyEditor.press('Enter')
    }
    await closeBottomSheets(page, retainedSheets)
    position = currentField('resume-profile-experience-specific-position-input')
    await position.fill(item.title)
    const positionEditor = page.locator('[data-qa="bottom-sheet-container"]:visible input:visible').first()
    if (await positionEditor.isVisible().catch(() => false)) {
      await positionEditor.press('Enter').catch(() => undefined)
    }
    await closeBottomSheets(page, retainedSheets)
    responsibilities = currentField('resume-profile-experience-specific-responsibilities-input')
    await responsibilities.fill(item.description)
    const responsibilitiesSave = page.locator('[data-qa="bottom-sheet-container"]:visible button:visible')
      .filter({ hasText: /^Сохранить$|^Save$/i }).last()
    if (await responsibilitiesSave.isVisible().catch(() => false)) {
      await responsibilitiesSave.click().catch(() => undefined)
    }
    await closeBottomSheets(page, retainedSheets)

    const setMonth = async (kind: 'datestart' | 'dateend', month: string) => {
      const control = currentField(`resume-profile-experience-specific-${kind}-month-input`)
      await control.click()
      const option = page.locator(`[data-qa="magritte-select-option-${month}"]:visible`)
      await option.waitFor({ state: 'visible', timeout: 5000 })
      await option.click()
      await closeBottomSheets(page, retainedSheets)
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
      if (!(await saveItem.isEnabled().catch(() => false))) throw profileFillerError(
        'profile_hh_experience_save_disabled',
        'HH experience Save control remained disabled after filling.', 'fill_resume')
      let closed = false
      for (let attempt = 0; attempt < 2 && !closed; attempt += 1) {
        await saveItem.click()
        for (let settle = 0; settle < 20 && !closed; settle += 1) {
          closed = !(await saveItem.isVisible().catch(() => false))
          if (!closed) await page.waitForTimeout(250)
        }
      }
      if (!closed) throw profileFillerError('profile_hh_experience_save_not_applied',
        'HH kept the experience editor open after one Save retry.', 'fill_resume')
      trace('editor-closed')
      if (currentResumeId) {
        await page.goto(`https://hh.ru/profile/resume/experience?resume=${currentResumeId}`, {
          waitUntil: 'domcontentloaded', timeout: 120_000
        })
        await page.waitForTimeout(1500)
      }
      if (!(await page.getByText(item.company, { exact: false }).isVisible().catch(() => false))) {
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

async function addEducation(page: Page, item: CvEducation, currentResumeId?: string) {
  const wizard = page.locator('[data-qa*="resume-profile-screen_educations"]:visible')
  if (await wizard.isVisible().catch(() => false)) {
    const level = await firstVisible([
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
        const educationSheet = page.locator('[data-qa="bottom-sheet-overlay"]:visible')
        if (await educationSheet.isVisible().catch(() => false)) {
          const close = await firstVisible([
            page.locator('[data-qa="select-bottom-sheet-navigation-close"]:visible')
          ])
          await close?.click({ force: true })
        }
        await page.keyboard.press('Escape').catch(() => undefined)
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
    const directUniversity = await firstVisible([
      wizard.locator('[data-qa="profile-education-university-input"]'),
      wizard.getByPlaceholder(/^Название$/i),
      wizard.getByLabel(/Учебное заведение|University|Institution/i)
    ])
    const textareas = wizard.locator('textarea:visible')
    let universityInput = directUniversity
    if (!universityInput && await textareas.count() >= 1) {
      await textareas.nth(0).click()
      universityInput = await firstVisible([
        page.locator('[data-qa="profile-education-university-input"]:visible')
      ])
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
      }
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
      }
    }
    const year = await firstVisible([
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

async function addLanguage(page: Page, item: CvLanguage) {
  const add = await firstVisible([
    page.locator('[data-qa="profile-language-add"]:visible'),
    page.getByText(/добавить язык/i).last(), page.getByText(/add language/i).last()
  ])
  const clicked = Boolean(add)
  if (add) await add.click()
  if (!clicked) return false
  await fill(page, item.name, ['Язык', 'Language'], ['input[name*="language"]'], true)
  await page.waitForTimeout(400)
  await clickText(page, [new RegExp(item.name, 'i')])
  await fill(page, item.level, ['Уровень', 'Level'], ['input[name*="level"]'])
  await clickText(page, [new RegExp(item.level, 'i')])
  await clickText(page, [/^сохранить$/i, /^save$/i], true)
  return true
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

async function hasProfileLanguage(page: Page, item: CvLanguage): Promise<boolean> {
  const { name, level } = profileLanguagePatterns(item)
  const rows = page.locator('[data-qa^="profile-language-card-row-"]:visible')
  for (let index = 0; index < await rows.count(); index += 1) {
    const text = String(await rows.nth(index).innerText().catch(() => '')).trim()
    if (name.test(text) && level.test(text)) return true
  }
  return false
}

async function addSkills(page: Page, skills: string[]) {
  const wizard = page.locator('[data-qa*="resume-profile-screen_keyskills"]:visible')
  if (await wizard.isVisible().catch(() => false)) {
    const trigger = wizard.locator('[data-qa="chips-input-suggest-trigger"]:visible')
    if (!(await trigger.isVisible().catch(() => false)) && skills.length) {
      throw profileFillerError('profile_hh_skills_control_missing',
        'HH skills search control was not found.', 'fill_resume')
    }
    let added = 0
    for (const skill of skills) {
      if (added >= 30) break
      let search = page.locator('[data-qa="chips-input-suggest-search"]:visible')
      if (!(await search.isVisible().catch(() => false))) {
        await trigger.click()
        search = page.locator('[data-qa="chips-input-suggest-search"]:visible')
        await search.waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined)
        // HH keeps the readonly trigger visible after the 30-skill limit is reached,
        // but no longer opens the search sheet.
        if (!(await search.isVisible().catch(() => false))) break
      }
      await search.fill(skill)
      await page.waitForTimeout(400)
      const escapedSkill = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const options = page.locator('[data-qa="suggest-item-chips"]:visible')
      const option = await firstVisible([
        options.filter({ hasText: new RegExp(`^${escapedSkill}$`, 'i') }),
        options
      ])
      if (!option) continue
      await option.click()
      added += 1
      await page.waitForTimeout(150)
    }
    if (await page.locator('[data-qa="bottom-sheet-overlay"]:visible').isVisible().catch(() => false)) {
      await page.keyboard.press('Escape').catch(() => undefined)
      await page.waitForTimeout(300)
    }
    return added
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
      await advanced.click()
    }
    return
  }
  for (const skill of skills) {
    const row = page.getByText(skill, { exact: true }).last()
    if (!(await row.isVisible().catch(() => false))) continue
    const container = row.locator('xpath=ancestor::*[self::div or self::li][1]')
    const advanced = await firstVisible([
      container.getByText(/продвинутый|advanced/i),
      page.getByText(/продвинутый|advanced/i).last()
    ])
    if (!advanced) throw profileFillerError('profile_hh_skill_level_missing',
      `Advanced level control was not found for skill "${skill}".`, 'fill_resume')
    await advanced.click()
  }
}

async function setWorkPreferences(page: Page, _market: 'Ru' | 'En') {
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
  /^(?:Уточните специальность|Refine (?:the )?speciali[sz]ation)$/i

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

export async function nextWizardStep(page: Page, stage: string) {
  const previousUrl = page.url()
  const previousScreen = await page.locator('[data-qa*="resume-profile-screen"]:visible').first()
    .getAttribute('data-qa').catch(() => undefined)
  for (let submitAttempt = 0; submitAttempt < 2; submitAttempt += 1) {
    await clickText(page, SAVE_AND_CONTINUE_PATTERNS, true)
    await page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => undefined)
    if (await waitForWizardTransition(page, previousUrl, previousScreen)) return

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
  await option.click()
  // HH visually hides the native checkbox. isVisible() therefore produces a
  // false negative even when React has checked it; inspect its state instead.
  let selected = false
  const nativeInput = rowFromText.locator(
    '[data-qa^="tree-selector-input"], input[type="checkbox"], input[type="radio"]'
  ).first()
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
    return await fill(page, value, ['Дата рождения', 'Birth date'], [
      'input[name="birthday"]', 'input[name*="birth"]'
    ])
  }
  const monthName = MONTH_NAMES_RU[parts.month - 1]
  const monthNameGenitive = MONTH_NAMES_RU_GENITIVE[parts.month - 1]
  const month = await firstVisible([
    page.locator('[data-qa="resume-profile-common-birthday-month-select"]'),
    page.locator('[data-qa="resume-profile-common-birthday-month"]'),
    page.getByText(new RegExp(`^(?:${monthName}|${monthNameGenitive})$`, 'i')).last(),
    page.getByText(/^(?:Месяц|Month)$/).last()
  ])
  const year = await firstVisible([
    page.locator('[data-qa="resume-profile-common-birthday-year-select"]'),
    page.locator('[data-qa="resume-profile-common-birthday-year"]'),
    page.getByText(new RegExp(`^${parts.year}$`)).last(),
    page.getByText(/^(?:Год|Year)$/).last()
  ])
  if (!month || !year) throw profileFillerError('profile_hh_required_field_missing',
    'Required HH birth date month or year control was not found.', 'fill_resume')

  const currentDay = String(await day.inputValue().catch(() => '')).trim().padStart(2, '0')
  const currentMonth = String(await month.getAttribute('data-value').catch(() => '') ||
    await month.innerText().catch(() => '')).trim()
  const currentYear = String(await year.getAttribute('data-value').catch(() => '') ||
    await year.innerText().catch(() => '')).trim()
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
  const titleFilled = await fill(page, desiredTitle, ['Профессия', 'Position', 'Resume title'], [
    '[data-qa="resume-edit-title-suggest"]', 'input[name="title"]',
    '[data-qa="resume-block-title-position"] input', '[data-qa*="title"] input'
  ])
  if (!titleFilled) throw profileFillerError('profile_hh_title_edit_missing',
    'HH resume title edit control was not found.', 'fill_resume')
  await setWorkPreferences(page, profile.client.market)
  await saveChangesWithoutPublishing(page)
  await page.goto(`https://hh.ru/resume/edit/${id}/position`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  await verifyWorkPreferences(page)

  await page.goto(`https://hh.ru/resume/edit/${id}/contacts`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  await fill(page, profile.cv.contacts.email, ['Электронная почта', 'Email'],
    ['[data-qa="resume-editor-email-input"]', 'input[type="email"]', 'input[name="email"]'], true)
  await fill(page, profile.cv.contacts.phone, ['Мобильный телефон', 'Phone'], [
    '[data-qa="resume-phone-cell_phone"]', 'input[name="phone.formatted"]'
  ])
  await setPreferredEmail(page)
  await saveChangesWithoutPublishing(page)
  await page.goto(`https://hh.ru/resume/edit/${id}/contacts`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  const preferredEmail = page.locator(
    '[data-qa="resume-editor-preferred-contact-email-checked"]')
  if (!(await preferredEmail.count()) ||
      !(await preferredEmail.isChecked().catch(() => false))) {
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

  await page.goto('https://hh.ru/applicant/profile/me', {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  for (const item of profile.cv.languages) {
    if (!(await hasProfileLanguage(page, item))) {
      if (!(await addLanguage(page, item))) throw profileFillerError(
        'profile_hh_language_control_missing', 'HH add-language control was not found.', 'fill_resume')
      await page.goto('https://hh.ru/applicant/profile/me', {
        waitUntil: 'domcontentloaded', timeout: 120_000
      })
      if (!(await hasProfileLanguage(page, item))) throw profileFillerError(
        'profile_hh_language_not_persisted',
        `HH did not persist language and level: ${item.name} ${item.level}.`, 'verify_draft')
    }
  }
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
  artifactDir: string): Promise<ResumeSnapshot> {
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
  await captureArtifactScreenshot(page, path.join(artifactDir, `final-draft-${id}.png`))
  return { id, title: actualTitle, href: `https://hh.ru/resume/${id}`,
    statusText: 'verified through unfinished HH draft wizard', isDraft: true }
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
      if (process.env.PROFILE_FILLER_ALLOW_EXISTING_PUBLISHED === '1' &&
          resumeId(page.url()) === existingDraftId) {
        const published: ResumeSnapshot = { id: existingDraftId, title, href: page.url(),
          statusText: 'published by HH wizard', isDraft: false }
        return await fillPublishedResumeCore(page, profile, published)
      }
      throw profileFillerError('profile_hh_existing_draft_unavailable',
        `HH incomplete resume ${existingDraftId} cannot be continued.`, 'create_resume')
    }
    resumable = { id: existingDraftId, title: targetTitle, href,
      statusText: 'incomplete', isDraft: true }
  } else {
    const professionStates: ProfessionState[] = []
    const captureProfessionState = async (stage: string) => {
      professionStates.push(await professionState(page, stage))
      fs.writeFileSync(path.join(artifactDir, 'profession-state.json'),
        `${JSON.stringify(professionStates, null, 2)}\n`, { mode: 0o600 })
    }
    await page.goto(HH_NEW_RESUME_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
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
  await nextWizardStep(page, 'personal information')

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
    const alreadyPresent = await page.getByText(item.institution, { exact: false })
      .isVisible().catch(() => false)
    if (!alreadyPresent && !(await addEducation(page, item, activeDraftId))) throw profileFillerError(
      'profile_hh_education_control_missing', 'HH add-education control was not found.', 'fill_resume')
  }
  await nextWizardStep(page, 'education')

  await addSkills(page, profile.cv.skills)
  await nextWizardStep(page, 'skills')
  if (await page.locator('[data-qa*="resume-profile-screen_skill_levels"]:visible')
    .isVisible().catch(() => false)) {
    await setAllSkillsAdvanced(page, profile.cv.skills)
    await nextWizardStep(page, 'skill levels')
  }

  if (!activeDraftId) throw profileFillerError('profile_hh_resume_not_created',
    'HH draft ID is unavailable before safe experience editing.', 'fill_resume')
  await page.goto(`https://hh.ru/resume/${activeDraftId}/experience`, {
      waitUntil: 'domcontentloaded', timeout: 120_000
  })
  await page.waitForTimeout(1500)
  for (const item of profile.cv.experience) {
    const alreadyPresent = await page.getByText(item.company, { exact: false })
      .isVisible().catch(() => false)
    if (!alreadyPresent && !(await addPublishedExperience(page, item))) throw profileFillerError(
      'profile_hh_experience_control_missing', 'HH add-experience control was not found.', 'fill_resume')
    await page.goto(`https://hh.ru/resume/${activeDraftId}/experience`, {
      waitUntil: 'domcontentloaded', timeout: 120_000
    })
    await page.waitForTimeout(700)
  }
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
  title: string, stack: string, market: 'Ru' | 'En'): Promise<ResumeSnapshot> {
  await page.goto(HH_RESUMES_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const sourceLink = page.locator(`[data-qa="resume-card-link-${source.id}"]`).first()
  await sourceLink.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
  const card = (await sourceLink.isVisible().catch(() => false))
    ? sourceLink.locator('xpath=ancestor::*[self::div or self::article][1]')
    : await resumeCard(page, source.id)
  const menu = card ? await firstVisible([
    card.locator('[data-qa="resume-list-action-more"]'),
    card.getByRole('button', { name: /ещё|more|actions/i })
  ]) : undefined
  if (!menu) throw profileFillerError('profile_hh_duplicate_unavailable',
    `Duplicate menu was not found for baseline resume ${source.id}.`, 'duplicate_resume')
  await menu.click()
  const duplicate = await firstVisible([
    page.getByText(/^Дублировать$/i), page.getByText(/^Duplicate$/i)
  ])
  if (!duplicate) throw profileFillerError('profile_hh_duplicate_unavailable',
    `Duplicate action was not found for baseline resume ${source.id}.`, 'duplicate_resume')
  await duplicate.click()
  await page.waitForURL(url => /\/profile\/resume\/professional_role/i.test(url.pathname) &&
    Boolean(url.searchParams.get('resume')), { timeout: 10_000 }).catch(() => undefined)

  const duplicatedId = resumeId(page.url())
  if (!duplicatedId || duplicatedId === source.id) {
    throw profileFillerError('profile_hh_duplicate_not_created',
      `HH did not create a new resume from baseline ${source.id}.`, 'duplicate_resume')
  }
  const targetTitle = professionForTitle(title, market)
  const profession = INITIAL_HH_PROFESSION
  const professionInput = await openProfessionEditor(page)
  await professionInput.fill(profession)
  if (!(await chooseFirstSuggestion(page, profession))) {
    throw profileFillerError('profile_hh_profession_suggestion_missing',
      `HH did not offer a profession matching "${profession}".`, 'duplicate_resume')
  }
  await selectRequiredSpecialization(page, stack, market)
  await page.locator('[data-qa="bottom-sheet-css-variables"]:visible')
    .waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
  const save = await firstVisible([page.locator('[data-qa="resume-profile-next-screen"]')])
  if (!save) throw profileFillerError('profile_hh_safe_save_missing',
    'HH duplicate save control was not found.', 'duplicate_resume')
  await save.click().catch(error => {
    if (!/suitable_vacancies|\/resume\//i.test(page.url())) throw error
  })
  await page.waitForTimeout(1200)
  const body = await page.locator('body').innerText().catch(() => '')
  if (/у вас уже существует резюме с такой должностью|resume with this position already exists/i.test(body)) {
    throw profileFillerError('profile_hh_profession_duplicate',
      `HH already has a resume for profession "${profession}".`, 'duplicate_resume')
  }

  await page.goto(`https://hh.ru/resume/edit/${duplicatedId}/position`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  await fill(page, targetTitle, ['Профессия', 'Position', 'Resume title'], [
    '[data-qa="resume-edit-title-suggest"]', 'input[name="title"]',
    '[data-qa="resume-block-title-position"] input', '[data-qa*="title"] input'
  ], true)
  await saveChangesWithoutPublishing(page)
  const listed = (await listResumes(page)).find(item => item.id === duplicatedId)
  if (!listed || listed.title.trim() !== targetTitle.trim()) {
    throw profileFillerError('profile_hh_title_verification_failed',
      `HH duplicated resume title does not match requested title "${targetTitle}".`, 'verify_draft')
  }
  return listed
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
  const card = await resumeCard(page, resume.id)
  const menu = card ? await firstVisible([
    card.locator('[data-qa="resume-list-action-more"]'),
    card.locator('[data-qa*="menu"]'),
    card.getByRole('button', { name: /ещё|more|actions/i })
  ]) : undefined
  if (!menu) throw profileFillerError('profile_hh_delete_unavailable',
    `Action menu was not found for old resume ${resume.id}.`, 'delete_old_resumes')
  await menu.click()
  await page.waitForTimeout(300)
  let deleteControl = await firstVisible([
    page.locator('[role="menu"]:visible').getByText(/^(?:Удалить резюме|Удалить|Delete resume|Delete)$/i),
    page.locator('[data-qa="bottom-sheet-css-variables"]:visible')
      .getByText(/^(?:Удалить резюме|Удалить|Delete resume|Delete)$/i),
    page.locator('[role="dialog"]:visible')
      .getByText(/^(?:Удалить резюме|Удалить|Delete resume|Delete)$/i),
    page.getByText(/^(?:Удалить резюме|Delete resume)$/i).last()
  ])
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
  }
  await deleteControl.click()
  const confirmation = await firstVisible([
    page.locator('[role="dialog"]:visible').getByRole('button', {
      name: /^(?:Удалить навсегда|Удалить|Подтвердить|Delete permanently|Delete|Confirm)$/i
    }),
    page.locator('[data-qa="bottom-sheet-css-variables"]:visible').getByRole('button', {
      name: /^(?:Удалить навсегда|Удалить|Подтвердить|Delete permanently|Delete|Confirm)$/i
    })
  ])
  if (!confirmation) throw profileFillerError('profile_hh_delete_confirmation_missing',
    `Delete confirmation was not found for old resume ${resume.id}.`, 'delete_old_resumes')
  await confirmation.click()
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
  profile: PreparedProfile) {
  // Draft list links reopen the unfinished wizard and do not expose visibility.
  // Privacy is a safe partial editor and must be addressed directly by resume ID.
  await openPrivacyEditor(page, resume.id)
  const visibilityCard = await firstVisible([
    page.locator('[data-qa="resume-visibility-card"]'),
    page.getByText(/видимость резюме|resume visibility|изменить видимость/i)
  ])
  if (!visibilityCard) throw profileFillerError('profile_hh_control_missing',
    'HH resume visibility control was not found.', 'configure_privacy')
  await visibilityCard.click()
  await page.waitForTimeout(500)

  const blacklist = await firstVisible([
    page.locator('[data-qa="resume-visibility-card-access-type-blacklist"]'),
    page.getByText(/скрыто от.*выбранных работодател|visible to everyone.*except/i)
  ])
  if (!blacklist) throw profileFillerError('profile_hh_control_missing',
    'HH employer blacklist visibility option was not found.', 'configure_privacy')
  await blacklist.click()

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
  const added: string[] = []
  const existing: string[] = []
  const skipped: Array<{ name: string; reason: string }> = []
  const employerActivator = await firstVisible([
    page.locator('[data-qa="applicant-employers-list-activator-blacklist"]')
  ])
  if (employerActivator) await employerActivator.click()
  const search = employerActivator ? await field(page,
    ['Найти работодателя', 'Find employer', 'Search employer', 'Поиск по названию'], [
      '[data-qa="resume-editor-employer-list-search-input"]',
      '[data-qa*="employer"] input', 'input[type="search"]'
    ]) : undefined
  for (const candidate of profile.employerCandidates) {
    if (!search) {
      skipped.push({ name: candidate.name, reason: 'employer_search_unavailable' })
      continue
    }
    await search.fill(candidate.name)
    await page.waitForTimeout(800)
    const rows = page.locator('label[data-qa="cell"]:visible')
      .filter({ has: page.locator('input[type="checkbox"]') })
    const options: Array<{ row: Locator; text: string }> = []
    for (let index = 0; index < await rows.count(); index += 1) {
      const row = rows.nth(index)
      const text = String(await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      if (!text || /фио|телефон|электронн|другие контакты|места работы/i.test(text)) continue
      options.push({ row, text })
    }
    const normalizedCandidate = candidate.name.toLocaleLowerCase('ru-RU')
      .replace(/[^a-zа-яё0-9]+/gi, '')
    let matches = options.filter(option => option.text.toLocaleLowerCase('ru-RU')
      .replace(/[^a-zа-яё0-9]+/gi, '').startsWith(normalizedCandidate))
    // HH lists the official Wildberries employer under the current RWB brand.
    if (normalizedCandidate === 'wildberries') {
      matches = options.filter(option => /^RWB\s*\(Wildberries\s*&\s*Russ\)/i.test(option.text))
    }
    if (matches.length !== 1) {
      skipped.push({ name: candidate.name, reason: options.length ? 'ambiguous' : 'not_found' })
      continue
    }
    const option = matches[0].row
    const checkbox = option.locator('input[type="checkbox"]').first()
    if (await checkbox.isChecked().catch(() => false)) existing.push(candidate.name)
    else {
      await option.click()
      added.push(candidate.name)
    }
  }
  if (search) {
    // Searching opens a nested sheet. The first action adds selected search
    // results; the second confirms the resulting employer list.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const modalSave = await firstVisible([
        page.locator('[data-qa="resume-modal-button-save"]'),
        page.getByText(/^готово$|^добавить$|^done$|^add$/i)
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
  const save = await firstVisible([
    page.locator('[data-qa="resume-partial-edit-save"]'),
    page.getByText(/^сохранить$|^save$/i)
  ])
  if (!save) throw profileFillerError('profile_hh_safe_save_missing',
    'HH privacy save control was not found.', 'configure_privacy')
  await save.click()
  await page.waitForTimeout(700)
  await openPrivacyEditor(page, resume.id)
  const savedBlacklist = page.locator(
    '[data-qa="resume-visibility-card-access-type-blacklist"] input').first()
  const savedPhone = page.locator(
    '[data-qa="resume-visibility-card-hidden-fields-phones"] input').first()
  if (!(await savedBlacklist.isChecked().catch(() => false)) ||
      !(await savedPhone.isChecked().catch(() => false))) {
    throw profileFillerError('profile_hh_privacy_verification_failed',
      'HH did not persist blacklist visibility and hidden structured phones.', 'verify_privacy')
  }
  const savedEmployerText = String(await page.locator(
    '[data-qa="applicant-employers-list-activator-blacklist"]:visible')
    .innerText().catch(() => ''))
  const persisted = (name: string) => {
    if (name.toLocaleLowerCase('ru-RU') === 'wildberries') {
      return /RWB\s*\(Wildberries\s*&\s*Russ\)/i.test(savedEmployerText)
    }
    return savedEmployerText.toLocaleLowerCase('ru-RU')
      .includes(name.toLocaleLowerCase('ru-RU'))
  }
  for (let index = added.length - 1; index >= 0; index -= 1) {
    if (!persisted(added[index])) {
      skipped.push({ name: added[index], reason: 'selection_not_persisted' })
      added.splice(index, 1)
    }
  }
  const beforePages = page.context().pages()
  const previewOpened = await clickText(page, [/как видят работодатели/i, /view as employer/i])
  if (!previewOpened) return { added, existing, skipped }
  await page.waitForTimeout(700)
  const preview = page.context().pages().find(item => !beforePages.includes(item)) ?? page
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
  return { added, existing, skipped }
}
