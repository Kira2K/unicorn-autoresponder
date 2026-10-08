import type { Page } from 'playwright'
import type { ResumeSnapshot } from './hh-resume-ui.ts'
import { profileFillerError } from './errors.ts'
import { assertCompleteSkills, skillKey, type SavedSkill } from './skill-selection.ts'

const SKILL_INPUT = '[data-qa="resume-editor-skills-input"]'
const SELECTED_SKILLS = `${SKILL_INPUT} [data-qa^="chips-trigger-chip-"]`

async function openSkillEditor(page: Page, resume: ResumeSnapshot): Promise<void> {
  if (!/^[a-z0-9]+$/i.test(resume.id)) throw profileFillerError(
    'profile_hh_invalid_resume_id', 'Skills require a known resume ID.', 'fill_skills')
  const url = `https://hh.ru/resume/edit/${resume.id}/keySkills`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator(SKILL_INPUT).waitFor({ state: 'visible', timeout: 30_000 })
  if (new URL(page.url()).pathname !== `/resume/edit/${resume.id}/keySkills`) throw profileFillerError(
    'profile_hh_skills_identity_mismatch', 'HH opened a different resume skills editor.', 'fill_skills')
}

async function selectedNames(page: Page): Promise<string[]> {
  return (await page.locator(SELECTED_SKILLS).allInnerTexts()).map(name => name.trim())
}

// Exact user-input tags are supported by HH; never replace one with an unrelated recommendation.
export async function saveResumeSkillNames(page: Page, resume: ResumeSnapshot, expected: string[]): Promise<void> {
  await openSkillEditor(page, resume)
  const wanted = new Set(expected.map(skillKey))
  const start = await selectedNames(page)
  if (start.length === expected.length && start.every(name => wanted.has(skillKey(name)))) return
  for (let index = start.length - 1; index >= 0; index -= 1) {
    if (!wanted.has(skillKey(start[index]))) {
      await page.locator(SELECTED_SKILLS).nth(index).locator('[data-qa="chip-delete-action"]').click()
    }
  }
  for (const name of expected) {
    if ((await selectedNames(page)).some(value => skillKey(value) === skillKey(name))) continue
    const trigger = page.locator(`${SKILL_INPUT} [data-qa="chips-trigger-input"]`)
    let input = trigger
    if (await trigger.getAttribute('readonly') !== null) {
      await trigger.click()
      input = page.locator('[data-qa="chips-input-suggest-search"]:visible').last()
    }
    await input.fill(name)
    const exact = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
    const option = page.locator('[data-qa="suggest-item-user-input"]:visible, [data-qa="suggest-item-chips"]:visible')
      .filter({ hasText: exact }).first()
    await option.waitFor({ state: 'visible', timeout: 10_000 })
    await option.click()
    await page.waitForFunction(({ selector, name }) => Array.from(document.querySelectorAll(selector))
      .some(item => item.textContent?.trim().toLowerCase() === name.toLowerCase()),
    { selector: SELECTED_SKILLS, name }, { timeout: 5000 })
  }
  await page.keyboard.press('Escape')
  const selected = await selectedNames(page)
  if (selected.length !== expected.length || selected.some(name => !wanted.has(skillKey(name)))) {
    throw profileFillerError('profile_hh_skills_incomplete', 'HH did not select the exact skill set.', 'fill_skills')
  }
  await page.getByRole('button', { name: /^(Сохранить|Save)$/i }).click()
  await page.waitForURL(url => url.pathname !== `/resume/edit/${resume.id}/keySkills`, {
    waitUntil: 'domcontentloaded', timeout: 30_000 })
  await openSkillEditor(page, resume)
  const persisted = await selectedNames(page)
  if (persisted.length !== expected.length || persisted.some(name => !wanted.has(skillKey(name)))) {
    throw profileFillerError('profile_hh_skills_incomplete', 'The complete skill set did not persist after save.', 'verify_skills')
  }
}

async function openLevels(page: Page, resume: ResumeSnapshot): Promise<void> {
  const route = `/resume/edit/${resume.id}/skillsLevels`
  await page.goto(`https://hh.ru${route}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('[data-qa="skill"]').first().waitFor({ state: 'visible', timeout: 30_000 })
  if (new URL(page.url()).pathname !== route) throw profileFillerError(
    'profile_hh_skills_identity_mismatch', 'HH opened a different skill levels editor.', 'verify_skills')
}

async function levelsFromEditor(page: Page): Promise<SavedSkill[]> {
  return page.locator('[data-qa="skill"]').evaluateAll(rows => rows.map(row => {
    const advanced = row.querySelector('[data-qa="skill-level-3"]')
      ?.closest('label')?.querySelector<HTMLInputElement>('input[type="radio"]')
    return { name: row.querySelector('[data-qa="skillName"]')?.textContent?.trim() ?? '',
      level: advanced?.checked === true ? 'advanced' : null }
  }))
}

export async function verifyResumeSkills(page: Page, resume: ResumeSnapshot, expected: string[]): Promise<SavedSkill[]> {
  await openSkillEditor(page, resume)
  const names = await selectedNames(page)
  // Check the persisted structured tags as well as the separate level form.
  assertCompleteSkills(names.map(name => ({ name, level: 'advanced' })), expected)
  await openLevels(page, resume)
  const levels = await levelsFromEditor(page)
  assertCompleteSkills(levels, expected)
  return levels
}

export async function ensureResumeSkills(page: Page, resume: ResumeSnapshot, expected: string[]): Promise<SavedSkill[]> {
  assertCompleteSkills(expected.map(name => ({ name, level: 'advanced' })), expected)
  await saveResumeSkillNames(page, resume, expected)
  await openLevels(page, resume)
  const current = await levelsFromEditor(page)
  assertCompleteSkills(current.map(item => ({ ...item, level: 'advanced' })), expected)
  let changed = false
  for (let index = 0; index < current.length; index += 1) {
    if (current[index].level === 'advanced') continue
    const row = page.locator('[data-qa="skill"]').nth(index)
    await row.locator('[data-qa="skill-level-3"]').click()
    if (!(await row.locator('[data-qa="skill-level-3"]').locator('xpath=ancestor::label[1]')
      .locator('input[type="radio"]').isChecked())) throw profileFillerError(
      'profile_hh_skill_level_missing', 'HH did not select Advanced for a skill.', 'fill_skills')
    changed = true
  }
  if (changed) {
    await page.getByRole('button', { name: /^(Сохранить|Save)$/i }).click()
    await page.waitForURL(url => url.pathname !== `/resume/edit/${resume.id}/skillsLevels`, {
      waitUntil: 'domcontentloaded', timeout: 30_000 })
  }
  // Reopen both sections after saving; a clicked radio is not persistence evidence.
  return verifyResumeSkills(page, resume, expected)
}
