import fs from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from 'playwright'
import { profileFillerError } from './errors.ts'
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
  return href.match(/\/resume\/([a-z0-9]+)/i)?.[1] ?? ''
}

export async function listResumes(page: Page): Promise<ResumeSnapshot[]> {
  await page.goto(HH_RESUMES_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForTimeout(1500)
  const anchors = page.locator([
    'a[data-qa^="resume-title-link"]',
    'a[href*="/resume/"]',
    'a[href*="/applicant/resumes/"]'
  ].join(','))
  const result = new Map<string, ResumeSnapshot>()
  for (let index = 0; index < await anchors.count(); index += 1) {
    const anchor = anchors.nth(index)
    const href = String(await anchor.getAttribute('href') ?? '')
    const id = resumeId(href)
    if (!id) continue
    const title = String(await anchor.innerText().catch(() => '')).trim()
    const card = anchor.locator('xpath=ancestor::*[self::div or self::article][1]')
    const statusText = String(await card.innerText().catch(() => '')).trim()
    result.set(id, { id, title, href: new URL(href, HH_RESUMES_URL).toString(),
      statusText, isDraft: /черновик|draft/i.test(statusText) })
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
  const snapshot = { url: page.url(), title: await page.title(), resumes,
    createControlVisible: Boolean(createControl), inspectedAt: new Date().toISOString() }
  const file = path.join(artifactDir, 'dry-run-hh-snapshot.json')
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 })
  await page.screenshot({ path: path.join(artifactDir, 'dry-run-resumes.png'), fullPage: true })
  if (!createControl) {
    throw profileFillerError('profile_hh_create_unavailable',
      'HH resume creation control is unavailable.', 'dry_run_hh', { artifact: file })
  }
  return { resumes, artifact: file }
}

async function setArea(page: Page, value?: string) {
  if (!value) return
  const changed = await fill(page, value, ['Город', 'City', 'Location'], [
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
}

async function addExperience(page: Page, item: CvExperience) {
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
  const input = await field(page, ['Навык', 'Skill'], [
    '[data-qa*="skills"] input', 'input[name*="skill"]'
  ])
  if (!input && skills.length) {
    throw profileFillerError('profile_hh_skills_control_missing',
      'HH skills control was not found.', 'fill_resume')
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

async function nextWizardStep(page: Page) {
  await clickText(page, [/сохранить и продолжить/i, /save and continue/i], true)
  await page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => undefined)
  await page.waitForTimeout(500)
  if (/код.*подтверждени|verification code|confirm.*phone/i.test(
    await page.locator('body').innerText())) {
    throw profileFillerError('profile_hh_phone_verification_required',
      'HH requires interactive phone verification.', 'create_resume')
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

async function chooseFirstSuggestion(page: Page, value: string) {
  await page.waitForTimeout(500)
  const option = await firstVisible([
    page.locator('[role="option"]').filter({ hasText: value }),
    page.locator('[role="option"]').first(),
    page.locator('[data-qa*="suggest"] li').first()
  ])
  await option?.click().catch(() => undefined)
}

async function fillSupplemental(page: Page, profile: PreparedProfile, title: string) {
  let titleFilled = await fill(page, title, ['Желаемая должность', 'Position', 'Resume title'], [
    'input[name="title"]', '[data-qa="resume-block-title-position"] input',
    '[data-qa*="title"] input'
  ])
  if (!titleFilled) {
    const edit = await clickText(page, [/редактировать резюме/i, /edit resume/i])
    if (edit) {
      await page.waitForTimeout(500)
      titleFilled = await fill(page, title, ['Желаемая должность', 'Position', 'Resume title'], [
        'input[name="title"]', '[data-qa="resume-block-title-position"] input',
        '[data-qa*="title"] input'
      ])
    }
  }
  if (!titleFilled) {
    const id = resumeId(page.url())
    if (id) {
      await page.goto(`https://hh.ru/resume/${id}/edit`, {
        waitUntil: 'domcontentloaded', timeout: 120_000
      })
      titleFilled = await fill(page, title, ['Желаемая должность', 'Position', 'Resume title'], [
        'input[name="title"]', '[data-qa="resume-block-title-position"] input',
        '[data-qa*="title"] input'
      ])
    }
  }
  if (!titleFilled) throw profileFillerError('profile_hh_title_edit_missing',
    'HH resume title edit control was not found.', 'fill_resume')
  await fill(page, profile.about, ['О себе', 'About me'], [
    'textarea[name="about"]', '[data-qa*="about"] textarea'
  ], true)
  await fill(page, profile.cv.contacts.email, ['Электронная почта', 'Email'],
    ['input[type="email"]', 'input[name="email"]'], true)
  await setPreferredEmail(page)
  await setWorkPreferences(page, profile.client.market)
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
  await saveChangesWithoutPublishing(page)
}

export async function createResumeDraft(page: Page, profile: PreparedProfile,
  title: string, artifactDir: string): Promise<ResumeSnapshot> {
  const before = await listResumes(page)
  await page.goto(HH_NEW_RESUME_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  if (/можно создать не более|resume limit|maximum number of resumes/i.test(await page.locator('body').innerText())) {
    throw profileFillerError('profile_hh_resume_limit',
      'HH resume limit prevents creating another draft.', 'create_resume')
  }
  const profession = profile.cv.position || title
  await fill(page, profession, ['Профессия', 'Profession', 'Желаемая должность', 'Position'], [
    'input[name="title"]', '[data-qa="resume-block-title-position"] input',
    '[data-qa*="title"] input'
  ], true)
  await chooseFirstSuggestion(page, profession)
  await nextWizardStep(page)

  await fill(page, profile.cv.firstName, ['Имя', 'First name'],
    ['input[name="firstName"]', '[data-qa*="first-name"] input'])
  await fill(page, profile.cv.lastName, ['Фамилия', 'Last name'],
    ['input[name="lastName"]', '[data-qa*="last-name"] input'])
  await fill(page, profile.cv.middleName, ['Отчество', 'Middle name'], ['input[name="middleName"]'])
  await fill(page, profile.cv.birthDate, ['Дата рождения', 'Birth date'], ['input[name*="birth"]'])
  await setArea(page, profile.cv.location)
  await fill(page, profile.cv.contacts.email, ['Электронная почта', 'Email'],
    ['input[type="email"]', 'input[name="email"]'])
  const preferred = await field(page, ['Предпочтительный способ связи', 'Preferred contact'])
  if (preferred) await setPreferredEmail(page)
  const travel = await firstVisible([page.getByText(/командиров|business trip/i)])
  if (travel) await setWorkPreferences(page, profile.client.market)
  await nextWizardStep(page)

  for (const item of profile.cv.education) {
    const alreadyPresent = await page.getByText(item.institution, { exact: false })
      .isVisible().catch(() => false)
    if (!alreadyPresent && !(await addEducation(page, item))) throw profileFillerError(
      'profile_hh_education_control_missing', 'HH add-education control was not found.', 'fill_resume')
  }
  await nextWizardStep(page)

  await addSkills(page, profile.cv.skills)
  await nextWizardStep(page)
  await setAllSkillsAdvanced(page, profile.cv.skills)
  await nextWizardStep(page)

  for (const item of profile.cv.experience) {
    const alreadyPresent = await page.getByText(item.company, { exact: false })
      .isVisible().catch(() => false)
    if (!alreadyPresent && !(await addExperience(page, item))) throw profileFillerError(
      'profile_hh_experience_control_missing', 'HH add-experience control was not found.', 'fill_resume')
  }
  await fill(page, profile.about, ['О себе', 'About me'], [
    'textarea[name="about"]', '[data-qa*="about"] textarea'
  ])
  // Do not click the final Save and continue: HH documents that it automatically publishes.
  await page.screenshot({ path: path.join(artifactDir,
    `created-${title.replace(/[^a-zа-я0-9]+/gi, '-').slice(0, 60)}.png`), fullPage: true })
  const after = await listResumes(page)
  const beforeIds = new Set(before.map(item => item.id))
  const created = after.find(item => !beforeIds.has(item.id)) ??
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
  const updated = (await listResumes(page)).find(item => item.id === created.id) ?? created
  if (!updated.isDraft) throw profileFillerError('profile_hh_unexpected_publication',
    `Resume ${created.id} stopped being a draft after editing.`, 'verify_draft')
  if (updated.title.trim() !== title.trim()) {
    throw profileFillerError('profile_hh_title_verification_failed',
      `HH draft title does not match the requested title "${title}".`, 'verify_draft')
  }
  return updated
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
  await clickText(page, [/видимость резюме/i, /resume visibility/i, /изменить видимость/i], true)
  await clickText(page, [/видно всем.*кроме/i, /visible to everyone.*except/i], true)
  await clickText(page, [/анонимное резюме/i, /anonymous resume/i], true)
  const phoneHidden = await setCheckboxNearText(page, /скрыть.*телефон|hide.*phone/i, true)
  if (!phoneHidden) throw profileFillerError('profile_hh_phone_privacy_missing',
    'HH hide-phone privacy control was not found.', 'configure_privacy')
  for (const visibleField of [/скрыть.*имя/i, /hide.*name/i, /скрыть.*почт/i,
    /hide.*email/i, /скрыть.*компан/i, /hide.*compan/i, /скрыть.*telegram/i,
    /hide.*telegram/i]) {
    await setCheckboxNearText(page, visibleField, false)
  }
  const added: string[] = []
  const existing: string[] = []
  const skipped: Array<{ name: string; reason: string }> = []
  for (const candidate of profile.employerCandidates) {
    const search = await field(page, ['Найти работодателя', 'Find employer', 'Search employer'], [
      '[data-qa*="employer"] input', 'input[type="search"]'
    ])
    if (!search) {
      skipped.push({ name: candidate.name, reason: 'employer_search_unavailable' })
      continue
    }
    await search.fill(candidate.name)
    await page.waitForTimeout(700)
    const options = page.locator('[role="option"], [data-qa*="employer-item"]')
      .filter({ hasText: candidate.name })
    const count = await options.count()
    if (count !== 1) {
      skipped.push({ name: candidate.name, reason: count ? 'ambiguous' : 'not_found' })
      continue
    }
    const option = options.first()
    const selected = await option.getAttribute('aria-selected')
    if (selected === 'true') existing.push(candidate.name)
    else {
      await option.click()
      added.push(candidate.name)
    }
  }
  await clickText(page, [/^сохранить$/i, /^save$/i], true)
  const beforePages = page.context().pages()
  await clickText(page, [/как видят работодатели/i, /view as employer/i], true)
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
