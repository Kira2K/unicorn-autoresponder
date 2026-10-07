import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { chooseFirstSuggestion, fillBirthDate, INITIAL_HH_PROFESSION, nextWizardStep,
  selectRequiredSpecialization, setWorkPreferences, dismissStaleContactsPrompt } from '../hh-resume-ui.ts'

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
    await page.route('**/*', route => route.abort())
    await page.setContent(fixture)

    assert.equal(await chooseFirstSuggestion(page, INITIAL_HH_PROFESSION), true)
    assert.equal(await page.locator('#specialization').isVisible(), true)
    // The old profession sheet deliberately remains mounted. The helper must
    // scope itself to the specialization overlay instead of selecting from it.
    assert.equal(await page.locator('#profession').isVisible(), true)
    assert.equal(await selectRequiredSpecialization(page, 'Java', 'En'), true)
    assert.equal(await page.locator('#specialization').count(), 0)

    // English HH uses "Specify specialisation" while the taxonomy stays Russian.
    for (const heading of ['Specify specialisation', 'Specify specialization']) {
      const englishPage = await browser.newPage()
      await englishPage.route('**/*', route => route.abort())
      await englishPage.setContent(fixture.replace('Уточните специальность', heading))
      await englishPage.locator('#profession-option').click()
      await englishPage.locator('#specialization').waitFor({ state: 'visible' })
      assert.equal(await selectRequiredSpecialization(englishPage, 'PYTHON', 'Ru'), true)
      assert.equal(await englishPage.locator('#specialization').count(), 0)
      await englishPage.close()
    }

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

    // Current HH uses named Magritte combobox wrappers, with duplicate hidden
    // labels elsewhere in the page. Read their input values on recovery.
    await page.setContent(`
      <input data-qa="resume-profile-common-birthday-day-input" value="07">
      <div role="combobox" aria-label="Месяц" data-qa="magritte-select-activator">
        <input role="combobox" aria-label="Месяц" value="Октября" readonly>
      </div>
      <div role="combobox" aria-label="Год" data-qa="magritte-select-activator">
        <input role="combobox" aria-label="Год" value="1990" readonly>
      </div>
      <span hidden>Месяц</span><span hidden>Год</span>
      <script>
        window.dateClicks = 0;
        document.querySelectorAll('div[role="combobox"]').forEach(control => {
          control.addEventListener('click', () => {
            window.dateClicks++;
            const option = document.createElement('button');
            option.setAttribute('role', 'option');
            option.textContent = '1988';
            option.onclick = () => { control.querySelector('input').value = '1988'; option.remove(); };
            document.body.append(option);
          });
        });
      </script>`)
    assert.equal(await fillBirthDate(page, '07.10.1988'), true)
    assert.equal(await page.locator('input[aria-label="Год"]').inputValue(), '1988')
    assert.equal(await page.evaluate(() => (window as any).dateClicks), 1)
    assert.equal(await fillBirthDate(page, '07.10.1988'), true)
    assert.equal(await page.evaluate(() => (window as any).dateClicks), 1)

    await page.locator('div[aria-label="Месяц"]').evaluate(element =>
      element.setAttribute('aria-label', 'Month'))
    await page.locator('div[aria-label="Год"]').evaluate(element =>
      element.setAttribute('aria-label', 'Year'))
    assert.equal(await fillBirthDate(page, '07.10.1988'), true)
    assert.equal(await page.evaluate(() => (window as any).dateClicks), 1)

    // Partial editors can retain English labels after switching the HH UI to Russian.
    await page.setContent(`
      <button role="combobox" data-qa="resume-edit-work-formats"
        onclick="document.querySelector('#formats').hidden=false">Work format</button>
      <section id="formats" hidden>
        ${['ON_SITE', 'REMOTE', 'HYBRID', 'FIELD_WORK', 'FLY_IN_FLY_OUT'].map(code =>
          `<button data-qa="magritte-select-option-${code}" aria-selected="${code === 'ON_SITE'}"
            onclick="this.setAttribute('aria-selected', this.getAttribute('aria-selected') !== 'true')">
            <input type="checkbox" ${code === 'ON_SITE' ? 'checked' : ''}>${code}</button>`).join('')}
        <button onclick="document.querySelector('#formats').hidden=true">Choose</button>
      </section>
      <button role="combobox" data-qa="resume-edit-business-trip-readiness"
        onclick="document.querySelector('#ready').hidden=false">Business trips</button>
      <button id="ready" data-qa="magritte-select-option-ready" hidden aria-selected="false"
        onclick="this.setAttribute('aria-selected','true');this.hidden=true"><input type="radio">Ready</button>`)
    await setWorkPreferences(page, 'Ru')
    for (const code of ['ON_SITE', 'REMOTE', 'HYBRID']) {
      assert.equal(await page.locator(`[data-qa="magritte-select-option-${code}"]`)
        .getAttribute('aria-selected'), 'true')
    }
    for (const code of ['FIELD_WORK', 'FLY_IN_FLY_OUT']) {
      assert.equal(await page.locator(`[data-qa="magritte-select-option-${code}"]`)
        .getAttribute('aria-selected'), 'false')
    }
    assert.equal(await page.locator('#ready').getAttribute('aria-selected'), 'true')

    await page.setContent(`<section role="dialog">
      <h2>Контакты в резюме могли устареть</h2>
      <button onclick="window.contactsReplaced=true">Заменить на новые из профиля</button>
      <button onclick="this.parentElement.remove()">Закрыть</button>
      </section>`)
    await dismissStaleContactsPrompt(page)
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.evaluate(() => Boolean((window as any).contactsReplaced)), false)
    await dismissStaleContactsPrompt(page)

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
