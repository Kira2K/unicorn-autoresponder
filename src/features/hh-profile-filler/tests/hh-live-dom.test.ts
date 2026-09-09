import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { chooseFirstSuggestion, fillBirthDate, INITIAL_HH_PROFESSION, nextWizardStep,
  selectRequiredSpecialization } from '../hh-resume-ui.ts'

const fixture = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/hh-wizard-observed.html'), 'utf8')

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true })
  } catch (error) {
    return await chromium.launch({ channel: 'chrome', headless: true }).catch(() => {
      throw error
    })
  }
}

export async function runHHLiveDomTests() {
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent(fixture)

    assert.equal(await chooseFirstSuggestion(page, INITIAL_HH_PROFESSION), true)
    assert.equal(await page.locator('#specialization').isVisible(), true)
    // The old profession sheet deliberately remains mounted. The helper must
    // scope itself to the specialization overlay instead of selecting from it.
    assert.equal(await page.locator('#profession').isVisible(), true)
    assert.equal(await selectRequiredSpecialization(page, 'Java', 'En'), true)
    assert.equal(await page.locator('#specialization').count(), 0)

    assert.equal(await fillBirthDate(page, '07.10.1988'), true)
    assert.equal(await page.locator(
      '[data-qa="resume-profile-common-birthday-day-input"]').inputValue(), '07')
    assert.equal(await page.locator(
      '[data-qa="resume-profile-common-birthday-month-select"]').getAttribute('data-value'),
    'Октября')
    assert.equal(await page.locator(
      '[data-qa="resume-profile-common-birthday-year-select"]').getAttribute('data-value'),
    '1988')

    await nextWizardStep(page, 'personal information')
    assert.match(String(await page.locator('#personal').getAttribute('data-qa')), /education/)

    // On a resumed wizard HH keeps data-qa only on the day input; the selected
    // month and year remain ordinary text buttons. An exact saved date must be
    // recognized and skipped without reopening either selector.
    await page.setContent(`
      <input data-qa="resume-profile-common-birthday-day-input" value="15">
      <button id="saved-month">Сентября</button>
      <button id="saved-year">1997</button>`)
    assert.equal(await fillBirthDate(page, '15.09.1997'), true)
    assert.equal(await page.locator('#saved-month').innerText(), 'Сентября')
    assert.equal(await page.locator('#saved-year').innerText(), '1997')

    // A screen heading beginning with "Выберите" is not a validation error.
    // HH occasionally ignores the first click while hydrating; the bounded
    // retry must still run and observe the second-click transition.
    await page.setContent(`
      <section id="profession-screen"
        data-qa="resume-profile-screen resume-profile-screen_professional_role">
        <h1>Выберите или укажите профессию</h1>
        <button data-qa="resume-profile-next-screen">Сохранить и продолжить</button>
      </section>
      <script>
        let clicks = 0
        document.querySelector('button').addEventListener('click', () => {
          clicks += 1
          if (clicks === 2) document.querySelector('section').dataset.qa =
            'resume-profile-screen resume-profile-screen_common'
        })
      </script>`)
    await nextWizardStep(page, 'profession')
    assert.match(String(await page.locator('#profession-screen').getAttribute('data-qa')), /common/)
  } finally {
    await browser.close()
  }
}
