import fs from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from 'playwright'
import { profileFillerError } from './errors.ts'
import { normalizeStack } from './stack-titles.ts'
import type { CvEducation, CvExperience, CvLanguage, PreparedProfile } from './types.ts'

const HH_RESUMES_URL = 'https://hh.ru/applicant/resumes'
const HH_NEW_RESUME_URL = 'https://hh.ru/applicant/resumes/new'

export type ResumeSnapshot = {
  id: string
  title: string
  href: string
  statusText?: string
  isDraft: boolean
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
    if (retain === 0 || count > retain) {
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
  await page.goto(HH_RESUMES_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForTimeout(1500)
  // The current applicant profile hides incomplete resumes in the compact list
  // until any resume action menu is opened. Expanding it is read-only and lets
  // replacement/duplication verification see drafts as well as published cards.
  const compactTrigger = await firstVisible([
    page.locator('[data-qa="resume-list-action-more"]')
  ])
  if (compactTrigger) {
    await compactTrigger.click()
    await page.waitForTimeout(200)
  }
  const anchors = page.locator([
    'a[data-qa^="resume-title-link"]',
    'a[data-qa^="resume-card-link-"]',
    'a[href*="/applicant/resumes/"]'
  ].join(','))
  const result = new Map<string, ResumeSnapshot>()
  for (let index = 0; index < await anchors.count(); index += 1) {
    const anchor = anchors.nth(index)
    const href = String(await anchor.getAttribute('href') ?? '')
    const id = resumeId(href)
    if (!id) continue
    const rawTitle = String(await anchor.innerText().catch(() => '')).trim()
    const title = rawTitle.split(/\r?\n/).map(line => line.trim()).find(line =>
      line && !/^(?:постоянная работа|частичная занятость|стажировка|проектная работа|full[- ]?time|part[- ]?time|internship|не\s*опубликовано|draft|уровень дохода|salary|\d+\s+ваканс)/i.test(line)) ?? rawTitle
    const card = anchor.locator('xpath=ancestor::*[self::div or self::article][1]')
    const statusText = String(await card.innerText().catch(() => '')).trim()
    const absoluteHref = new URL(href, HH_RESUMES_URL).toString()
    if (result.has(id)) continue
    result.set(id, { id, title, href: absoluteHref,
      statusText, isDraft: /черновик|draft|не\s*опубликовано|заполните резюме|continue filling/i.test(statusText) ||
        /\/profile\/resume\//i.test(new URL(absoluteHref).pathname) })
  }
  return [...result.values()]
}

export async function inspectHH(page: Page, artifactDir: string) {
  const resumes = await listResumes(page)
  const createControl = await firstVisible([
    page.locator('[data-qa="resume-create-button"]'),
    page.locator('a[href*="/applicant/resumes/new"]'),
    page.getByText(/создать резюме|create resume/i)
  ])
  await page.screenshot({ path: path.join(artifactDir, 'dry-run-resumes.png'), fullPage: true })
  if (!createControl) {
    throw profileFillerError('profile_hh_create_unavailable',
      'HH resume creation control is unavailable.', 'dry_run_hh')
  }
  await page.goto(HH_NEW_RESUME_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const professionInput = await openProfessionEditor(page)
  const professionControlVisible = await professionInput.isVisible().catch(() => false)
  await page.screenshot({ path: path.join(artifactDir, 'dry-run-profession.png'), fullPage: true })
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
  const add = page.getByRole('button', { name: /^Добавить$|^Add$/i })
  if (!(await add.isVisible().catch(() => false))) throw profileFillerError(
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

async function addExperience(page: Page, item: CvExperience) {
  const wizard = page.locator('[data-qa*="resume-profile-screen_experience"]:visible')
  const publishedEditor = /\/resume\/[a-z0-9]+\/experience/i.test(new URL(page.url()).pathname)
  if (publishedEditor) return await addPublishedExperience(page, item)
  if (await wizard.isVisible().catch(() => false) || publishedEditor) {
    let company = page.locator(
      '[data-qa*="resume-profile-experience-specific-company-input"]:visible').first()
    let itemSheet = false
    const activeCompanyIsFilled = await company.isVisible().catch(() => false) &&
      Boolean(String(await company.inputValue().catch(() => '')).trim())
    if (!(await company.isVisible().catch(() => false)) || activeCompanyIsFilled) {
      // The list action is rendered next to the screen portal, not inside the
      // screen subtree itself.
      const add = await firstVisible([
        page.locator('button[data-qa="list-add"]:visible').filter({ hasText: /^Добавить$|^Add$/i }),
        page.getByRole('button', { name: /^Добавить$|^Add$/i })
      ])
      if (!add) return false
      await add.click()
      itemSheet = true
      company = page.locator(
        '[data-qa*="resume-profile-experience-specific-company-input"]:visible').first()
      await company.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
    }
    if (!(await company.isVisible().catch(() => false))) return false
    const companyQa = String(await company.getAttribute('data-qa') ?? '')
    const index = Number(companyQa.match(/company-input-(\d+)/)?.[1] ?? -1)
    if (index < 0) return false
    const retainedSheets = itemSheet
      ? await page.locator('[data-qa="bottom-sheet-css-variables"]:visible').count()
      : 0
    const position = page.locator(`[data-qa="resume-profile-experience-specific-position-input-${index}"]:visible`).first()
    const responsibilities = page.locator(
      `[data-qa="resume-profile-experience-specific-responsibilities-input-${index}"]`)
    if (!(await company.isVisible().catch(() => false)) ||
        !(await position.isVisible().catch(() => false)) ||
        !(await responsibilities.isVisible().catch(() => false))) return false

    const targetResumeId = resumeId(page.url())
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
    await position.fill(item.title)
    const positionEditor = page.locator('[data-qa="bottom-sheet-container"]:visible input:visible').first()
    if (await positionEditor.isVisible().catch(() => false)) {
      await positionEditor.press('Enter').catch(() => undefined)
    }
    await closeBottomSheets(page, retainedSheets)
    await responsibilities.fill(item.description)
    const responsibilitiesSave = page.locator('[data-qa="bottom-sheet-container"]:visible button:visible')
      .filter({ hasText: /^Сохранить$|^Save$/i }).last()
    if (await responsibilitiesSave.isVisible().catch(() => false)) {
      await responsibilitiesSave.click().catch(() => undefined)
    }
    await closeBottomSheets(page, retainedSheets)

    const setMonth = async (kind: 'datestart' | 'dateend', month: string) => {
      const control = page.locator(
        `[data-qa="resume-profile-experience-specific-${kind}-month-input-${index}"]`)
      await control.click()
      const option = page.locator(`[data-qa="magritte-select-option-${month}"]:visible`)
      await option.waitFor({ state: 'visible', timeout: 5000 })
      await option.click()
      await closeBottomSheets(page, retainedSheets)
    }
    const [startMonth, startYear] = (item.startDate ?? '').split('/')
    if (startMonth && startYear) {
      await setMonth('datestart', startMonth.padStart(2, '0'))
      const startYearControl = page.locator(
        `[data-qa="resume-profile-experience-specific-datestart-year-input-${index}"]`)
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
        const endYearControl = page.locator(
          `[data-qa="resume-profile-experience-specific-dateend-year-input-${index}"]`)
        await endYearControl.fill(endYear)
        await endYearControl.press('Tab')
        await page.waitForTimeout(300)
      }
    }
    if (itemSheet) {
      const saveItem = page.locator('[data-qa="modal-edit-list-item-save"]:visible')
      if (!(await saveItem.isEnabled().catch(() => false))) return false
      await saveItem.click()
      await page.waitForTimeout(500)
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

async function addEducation(page: Page, item: CvEducation) {
  const wizard = page.locator('[data-qa*="resume-profile-screen_educations"]:visible')
  if (await wizard.isVisible().catch(() => false)) {
    const level = await firstVisible([
      wizard.locator('[data-qa="magritte-select-activator"]')
    ])
    if (item.degree && level) {
      await level.click()
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
    // HH checks other resumes by default. Disable propagation before opening the
    // university and specialty suggestion sheets; those sheets can otherwise
    // absorb checkbox clicks after text entry.
    const propagateNames = await wizard.locator('input[type="checkbox"][name]:checked')
      .evaluateAll(inputs => inputs.map(input => input.getAttribute('name')).filter(Boolean) as string[])
    for (const name of propagateNames) {
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
    const textareas = wizard.locator('textarea:visible')
    if (await textareas.count() < 1) return false
    await textareas.nth(0).click()
    const universityInput = page.locator('[data-qa="profile-education-university-input"]:visible')
    await universityInput.waitFor({ state: 'visible', timeout: 5000 })
    await universityInput.fill(item.institution)
    await page.waitForTimeout(700)
    const escapedInstitution = item.institution.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const universityOption = await firstVisible([
      page.locator('[data-qa="suggest-item-cell"]:visible')
        .filter({ hasText: new RegExp(escapedInstitution, 'i') })
    ])
    if (!universityOption) throw profileFillerError('profile_hh_education_institution_missing',
      `HH did not offer the institution "${item.institution}".`, 'fill_resume')
    await universityOption.click()
    await page.waitForTimeout(300)
    if (item.specialization && await textareas.count() >= 3) {
      await textareas.nth(2).click()
      const specialtyInput = page.locator('[data-qa="profile-education-specialty-input"]:visible')
      await specialtyInput.waitFor({ state: 'visible', timeout: 5000 })
      await specialtyInput.fill(item.specialization)
      await page.waitForTimeout(700)
      const escapedSpecialization = item.specialization.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const specialtyOptions = page.locator('[data-qa="suggest-item-cell"]:visible')
        .filter({ hasText: new RegExp(escapedSpecialization, 'i') })
      const prefersMaster = /магистр|master/i.test(item.degree ?? '')
      const specialtyOption = prefersMaster
        ? await firstVisible([specialtyOptions.filter({ hasText: /магистр|master/i }), specialtyOptions])
        : await firstVisible([specialtyOptions])
      if (!specialtyOption) throw profileFillerError('profile_hh_education_specialty_missing',
        `HH did not offer the specialization "${item.specialization}".`, 'fill_resume')
      await specialtyOption.click()
      await page.waitForTimeout(300)
    }
    const year = wizard.locator('input:visible:not([type="checkbox"]):not([type="radio"])').first()
    if (item.graduationYear && await year.isVisible().catch(() => false)) {
      await year.fill(String(item.graduationYear))
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
  const clicked = await clickText(page, [/добавить язык/i, /add language/i])
  if (!clicked) return false
  await fill(page, item.name, ['Язык', 'Language'], ['input[name*="language"]'], true)
  await page.waitForTimeout(400)
  await clickText(page, [new RegExp(item.name, 'i')])
  await fill(page, item.level, ['Уровень', 'Level'], ['input[name*="level"]'])
  await clickText(page, [new RegExp(item.level, 'i')])
  await clickText(page, [/^сохранить$/i, /^save$/i], true)
  return true
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

async function setWorkPreferences(page: Page, market: 'Ru' | 'En') {
  const travel = await clickText(page, market === 'Ru'
    ? [/могу.*командиров/i, /готов.*командиров/i]
    : [/ready.*business trip/i, /business trips.*ready/i])
  if (!travel) throw profileFillerError('profile_hh_travel_control_missing',
    'HH business trips control was not found.', 'fill_resume')
  const formats = market === 'Ru'
    ? [/на месте работодателя/i, /удален/i, /гибрид/i]
    : [/on.?site/i, /remote/i, /hybrid/i]
  for (const pattern of formats) {
    if (!(await setCheckboxNearText(page, pattern, true))) {
      throw profileFillerError('profile_hh_work_format_missing',
      `HH work format control was not found: ${pattern}.`, 'fill_resume')
    }
  }
}

async function setPreferredEmail(page: Page) {
  await clickText(page, [/предпочтительный способ связи/i, /preferred contact/i], true)
  await clickText(page, [/электронн.*почт/i, /^email$/i], true)
}

export const SAVE_AND_CONTINUE_PATTERNS = [
  /сохранить\s+и\s+продолжить/i,
  /save\s+and\s+continue/i
]

async function nextWizardStep(page: Page, stage: string) {
  const previousUrl = page.url()
  const previousScreen = await page.locator('[data-qa*="resume-profile-screen"]:visible').first()
    .getAttribute('data-qa').catch(() => undefined)
  await clickText(page, SAVE_AND_CONTINUE_PATTERNS, true)
  await page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => undefined)
  await page.waitForTimeout(1000)
  const bodyText = await page.locator('body').innerText()
  if (/код.*подтверждени|verification code|confirm.*phone/i.test(bodyText)) {
    throw profileFillerError('profile_hh_phone_verification_required',
      'HH requires interactive phone verification.', 'create_resume')
  }
  const currentScreen = await page.locator('[data-qa*="resume-profile-screen"]:visible').first()
    .getAttribute('data-qa').catch(() => undefined)
  const urlUnchanged = page.url() === previousUrl
  const screenUnchanged = !previousScreen || currentScreen === previousScreen
  if (urlUnchanged && screenUnchanged) {
    const validation = bodyText.split(/\r?\n/).map(line => line.trim()).find(line =>
      /^(?:укажите|выберите|заполните|добавьте|enter|select|specify|required)/i.test(line))
    throw profileFillerError('profile_hh_wizard_validation_failed',
      `HH did not advance from the ${stage} step${validation ? `: ${validation}` : '.'}`,
      'fill_resume')
  }
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
  await button.click()
  await page.waitForTimeout(500)
  return true
}

export async function chooseFirstSuggestion(page: Page, value: string): Promise<boolean> {
  let option: Locator | undefined
  for (let attempt = 0; attempt < 20 && !option; attempt += 1) {
    option = await firstVisible([
      page.locator('[role="option"]').filter({ hasText: value }),
      page.locator('[role="option"]').first(),
      page.locator('[data-qa*="suggest"] li').first(),
      page.locator('[data-qa="bottom-sheet-css-variables"]:visible')
        .getByText(value, { exact: true }).last(),
      page.getByText(value, { exact: true }).last()
    ])
    if (!option) await page.waitForTimeout(500)
  }
  if (!option) return false
  await option.click()
  const specialization = page.locator('[data-qa="tree-selector-search-input"]:visible')
  // HH replaces the profession sheet with the specialization sheet asynchronously.
  // Closing the first sheet during that transition clears the selected profession.
  await specialization.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
  return true
}

export function specializationForStack(stack: string, market: 'Ru' | 'En') {
  const normalized = normalizeStack(stack)
  if (normalized === 'devops') {
    return market === 'Ru'
      ? { query: 'DevOps', label: 'DevOps-инженер' }
      : { query: 'DevOps', label: 'DevOps engineer' }
  }
  if (normalized === 'manualqa' || normalized === 'aqapython' || normalized === 'aqajava') {
    return market === 'Ru'
      ? { query: 'тестировщик', label: 'Тестировщик' }
      : { query: 'tester', label: 'Tester' }
  }
  return market === 'Ru'
    ? { query: 'разработчик', label: 'Программист, разработчик' }
    : { query: 'developer', label: 'Programmer, developer' }
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
  const searchControl = page.locator('[data-qa="tree-selector-search-input"]')
  await searchControl.first().waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => undefined)
  const search = await firstVisible([
    searchControl
  ])
  if (!search) return false
  const specialization = specializationForStack(stack, market)
  await search.fill(specialization.query)
  await page.waitForTimeout(500)
  const option = await firstVisible([
    page.locator('[data-qa^="tree-selector-item"]').filter({ hasText: specialization.label }),
    page.getByText(specialization.label, { exact: true })
  ])
  if (!option) {
    throw profileFillerError('profile_hh_specialization_missing',
      `HH did not offer the required specialization "${specialization.label}".`, 'fill_resume')
  }
  await option.click()
  const selected = await firstVisible([
    page.locator('[data-qa^="tree-selector-input"]:checked')
  ])
  if (!selected) {
    throw profileFillerError('profile_hh_specialization_not_selected',
      `HH did not select the specialization "${specialization.label}".`, 'fill_resume')
  }
  const submit = await firstVisible([
    page.locator('[data-qa="category-modal-submit"]')
  ])
  if (!submit) {
    throw profileFillerError('profile_hh_specialization_submit_missing',
      'HH specialization confirmation control was not found.', 'fill_resume')
  }
  await submit.click()
  await page.locator('[data-qa="bottom-sheet-overlay"]:visible')
    .waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
  return true
}

async function openSpecializationPicker(page: Page): Promise<void> {
  const searchControl = page.locator('[data-qa="tree-selector-search-input"]:visible')
  if (!(await searchControl.isVisible().catch(() => false))) {
    const next = await firstVisible([page.locator('[data-qa="resume-profile-next-screen"]')])
    if (!next) throw profileFillerError('profile_hh_control_missing',
      'Required HH profession continue control was not found.', 'create_resume')
    await next.click()
    await searchControl.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
  }
  if (!(await firstVisible([page.locator('[data-qa="tree-selector-search-input"]')]))) {
    const bodyText = await page.locator('body').innerText()
    const duplicate = /у вас уже существует резюме с такой должностью|resume with this position already exists/i
      .test(bodyText)
    throw profileFillerError(duplicate
      ? 'profile_hh_profession_duplicate' : 'profile_hh_specialization_missing', duplicate
      ? 'HH already has an incomplete resume with this profession.'
      : 'HH did not open the required specialization picker.', 'create_resume')
  }
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

  await page.goto(`https://hh.ru/resume/edit/${id}/about`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  await fill(page, profile.about, ['О себе', 'About me'], [
    '[data-qa="resume-editor-about"]', 'textarea[name="about"]', '[data-qa*="about"] textarea'
  ], true)
  await saveChangesWithoutPublishing(page)

  await page.goto(`https://hh.ru/resume/${id}`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
  for (const item of profile.cv.languages) {
    if (!(await page.getByText(item.name, { exact: true }).isVisible().catch(() => false))) {
      if (!(await addLanguage(page, item))) throw profileFillerError(
        'profile_hh_language_control_missing', 'HH add-language control was not found.', 'fill_resume')
    }
  }
  if (profile.client.market === 'En') {
    await clickText(page, [/work permits?|разрешени.*на работу/i], true)
    for (const permit of ['Georgia', 'Serbia', 'Armenia']) {
      if (!(await setCheckboxNearText(page, new RegExp(`^${permit}$`, 'i'), true))) {
        throw profileFillerError('profile_hh_work_permit_missing',
          `HH work permit control was not found: ${permit}.`, 'fill_resume')
      }
    }
  }
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
  const profession = professionForTitle(title, profile.client.market)
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
    resumable = { id: existingDraftId, title: profession, href,
      statusText: 'incomplete', isDraft: true }
  } else {
    await page.goto(HH_NEW_RESUME_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    if (/можно создать не более|resume limit|maximum number of resumes/i.test(await page.locator('body').innerText())) {
      throw profileFillerError('profile_hh_resume_limit',
        'HH resume limit prevents creating another draft.', 'create_resume')
    }
    const professionInput = await openProfessionEditor(page)
    await professionInput.fill(profession)
    if (!(await chooseFirstSuggestion(page, profession))) {
      throw profileFillerError('profile_hh_profession_suggestion_missing',
        `HH did not offer a profession matching "${profession}".`, 'fill_resume')
    }
    await openSpecializationPicker(page)
    await selectRequiredSpecialization(page, profile.client.stack, profile.client.market)
    if (!/\/profile\/resume\/common/i.test(new URL(page.url()).pathname)) {
      const continueButton = await firstVisible([
        page.locator('[data-qa="resume-profile-next-screen"]')
      ])
      if (!continueButton) throw profileFillerError('profile_hh_control_missing',
        'Required HH profession continue control was not found after specialization.',
        'create_resume')
      await continueButton.click()
    }
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
  await fill(page, structuredBirthDate, ['Дата рождения', 'Birth date'], [
    'input[name="birthday"]', 'input[name*="birth"]'])
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

  for (const item of profile.cv.education) {
    const alreadyPresent = await page.getByText(item.institution, { exact: false })
      .isVisible().catch(() => false)
    if (!alreadyPresent && !(await addEducation(page, item))) throw profileFillerError(
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

  for (const item of profile.cv.experience) {
    const alreadyPresent = await page.getByText(item.company, { exact: false })
      .isVisible().catch(() => false)
    if (!alreadyPresent && !(await addExperience(page, item))) throw profileFillerError(
      'profile_hh_experience_control_missing', 'HH add-experience control was not found.', 'fill_resume')
  }
  if (process.env.PROFILE_FILLER_INSPECT_FINAL_STEP === '1') {
    const diagnostic = path.join(artifactDir, 'final-wizard-step.png')
    await page.screenshot({ path: diagnostic, fullPage: true })
    throw profileFillerError('profile_hh_final_step_inspection',
      `HH final wizard step captured at ${diagnostic}.`, 'fill_resume')
  }
  // Do not advance from experience: the current HH wizard publishes immediately.
  // Any later optional sections must be edited through safe partial-edit routes.
  await page.screenshot({ path: path.join(artifactDir,
    `created-${title.replace(/[^a-zа-я0-9]+/gi, '-').slice(0, 60)}.png`), fullPage: true })
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
  if (updated.title.trim() !== profession.trim()) {
    throw profileFillerError('profile_hh_title_verification_failed',
      `HH draft title does not match the requested profession "${profession}".`, 'verify_draft')
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
  const profession = professionForTitle(title, market)
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

  const listed = (await listResumes(page)).find(item => item.id === duplicatedId)
  if (!listed || listed.title.trim() !== profession.trim()) {
    throw profileFillerError('profile_hh_title_verification_failed',
      `HH duplicated resume title does not match profession "${profession}".`, 'verify_draft')
  }
  return listed
}

async function resumeCard(page: Page, id: string): Promise<Locator | undefined> {
  const link = page.locator(`a[href*="/resume/${id}"]`).first()
  if (!(await link.count())) return undefined
  return link.locator('xpath=ancestor::*[self::div or self::article][1]')
}

export async function deleteResume(page: Page, resume: ResumeSnapshot): Promise<void> {
  await page.goto(HH_RESUMES_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const card = await resumeCard(page, resume.id)
  const menu = card ? await firstVisible([
    card.locator('[data-qa*="menu"]'), card.getByRole('button', { name: /ещё|more|actions/i })
  ]) : undefined
  await menu?.click()
  const clicked = await clickText(page, [/удалить резюме/i, /delete resume/i])
  if (!clicked) {
    throw profileFillerError('profile_hh_delete_unavailable',
      `Delete control was not found for old resume ${resume.id}.`, 'delete_old_resumes')
  }
  await clickText(page, [/подтвердить|удалить/i, /confirm|delete/i], true)
}

export async function configurePrivacyAndStopList(page: Page, resume: ResumeSnapshot,
  profile: PreparedProfile) {
  await page.goto(resume.href, { waitUntil: 'domcontentloaded', timeout: 120_000 })
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
  await page.goto(`https://hh.ru/resume/edit/${resume.id}/visibility`, {
    waitUntil: 'domcontentloaded', timeout: 120_000
  })
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
