import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { hhCookieConsentFailure, installHhCookieConsentForContext } from '../hh-overlays.ts'
import { openResumeActions } from '../hh-duplicate-menu.ts'
import { addSkills, acceptEducationFreeText, acceptExperienceFreeText, chooseFirstSuggestion, deleteResume, fillBirthDate,
  findEducationUniversityInput,
  INITIAL_HH_PROFESSION, nextWizardStep,
  closeExperienceTextEditor, dismissExperienceOverlayBlocking,
  dismissStaleResumeContactsPrompt,
  saveExperienceResponsibilitiesEditor,
  selectRequiredSpecialization, setArea, syncProfileLanguages, syncResumeEducationSelection,
  setExperienceResumePropagation, syncResumeExperienceSelection } from '../hh-resume-ui.ts'

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
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.route('**/*', route => route.abort())
    await installHhCookieConsentForContext(page.context())

    await page.route('https://hh.test/**', route => route.fulfill({ contentType: 'text/html', body:
      new URL(route.request().url()).pathname === '/applicant/my_resumes'
        ? `<div><a href="/resume/old123">Old resume</a><button data-qa="resume-list-action-more"
            onclick="window.wrongMenu=true">Old actions</button></div>
           <div><a href="/profile/resume?resume=draft123">Draft</a>
           <button data-qa="resume-list-action-more" onclick="window.correctMenu=true">Draft actions</button></div>`
        : `<div data-qa="resume"><a href="/resume/old123">Old resume</a>
             <button data-qa="resume-list-action-more" onclick="window.wrongMenu=true">Old actions</button></div>
           <div data-qa="resume"><a href="/profile/resume?resume=draft123">Draft</a></div>
           <a data-qa="compact-resume-show-more" href="/applicant/my_resumes">All resumes</a>`
    }))
    await page.goto('https://hh.test/applicant/profile/me')
    await openResumeActions(page, 'draft123')
    assert.equal(new URL(page.url()).pathname, '/applicant/my_resumes')
    assert.equal(await page.evaluate(() => Boolean((window as any).correctMenu)), true)
    assert.equal(await page.evaluate(() => Boolean((window as any).wrongMenu)), false)
    await page.unroute('https://hh.test/**')

    await page.setContent(`<section data-qa="resume-profile-screen_keyskills">
      <button data-qa="chips-input-suggest-trigger">Skills</button><div id="chosen"></div>
      </section><input data-qa="chips-input-suggest-search"><div id="suggestions"></div>
      <script>document.querySelector('input').addEventListener('input', () => {
        setTimeout(() => {
          const b=document.createElement('button');b.dataset.qa='suggest-item-chips';b.textContent='PostgreSQL';
          b.onclick=()=>{document.querySelector('#chosen').innerHTML='<span data-qa="chips-trigger-chip-1">PostgreSQL</span>';b.remove()};
          document.querySelector('#suggestions').append(b)
        }, 900)
      })</script>`)
    assert.equal(await addSkills(page, ['PostgreSQL']), 1)

    await page.setContent(`<section data-qa="resume-profile-screen_keyskills">
      <div data-qa="chips-input-suggest-trigger" style="width:600px;height:50px;position:relative">
        <span data-qa="chips-trigger-chip-1">Go (Golang)</span>
        <button style="position:absolute;left:280px;top:0;width:40px;height:50px"
          onclick="window.deleted=true;document.querySelector('[data-qa^=chips-trigger-chip]').remove()">X</button>
        <input data-qa="chips-trigger-input" style="position:absolute;right:0;width:100px"
          onclick="document.querySelector('#search').style.display='block'">
      </div></section>
      <input id="search" data-qa="chips-input-suggest-search" style="display:none"
        oninput="document.querySelector('#option').style.display='block'">
      <button id="option" data-qa="suggest-item-chips" style="display:none"
        onclick="document.querySelector('section').insertAdjacentHTML('beforeend','<span data-qa=chips-trigger-chip-2>Python</span>');this.remove()">Python</button>`)
    assert.equal(await addSkills(page, ['Go', 'Python']), 2)
    assert.equal(await page.evaluate(() => Boolean((window as any).deleted)), false)

    await page.setContent(`
      <aside id="cookie-notice">
        <p>Чтобы сайт был удобнее, используем <a href="/cookies">cookies</a></p>
        <button data-qa="cookies-policy-informer-accept">Понятно</button>
      </aside>
      <button id="cookie-target">Продолжить</button>
      <script>
        document.querySelector('[data-qa="cookies-policy-informer-accept"]')
          .addEventListener('click', () => {
            window.cookieAccepted = true
            document.querySelector('#cookie-notice').remove()
          })
        document.querySelector('#cookie-target').addEventListener('click', () => {
          window.targetClicked = true
        })
      </script>`)
    await page.locator('#cookie-target').click()
    await page.waitForFunction(() => Boolean((window as any).cookieAccepted))
    assert.equal(await page.evaluate(() => Boolean((window as any).cookieAccepted)), true)
    assert.equal(await page.evaluate(() => Boolean((window as any).targetClicked)), true)

    await page.setContent(`
      <div data-qa="bottom-sheet-content">
        <input placeholder="Название учебного заведения" value="">
      </div>`)
    const observedEducationInput = await findEducationUniversityInput(page)
    assert.ok(observedEducationInput)
    await observedEducationInput.fill('Observed University')
    assert.equal(await observedEducationInput.inputValue(), 'Observed University')

    await page.setContent(`
      <textarea id="saved-university"></textarea>
      <div id="university-sheet" data-qa="bottom-sheet-content">
        <input id="university-input" data-qa="profile-education-university-input">
      </div>
      <script>
        document.querySelector('#university-input').addEventListener('keydown', event => {
          if (event.key !== 'Enter') return
          document.querySelector('#saved-university').value = event.target.value
          document.querySelector('#university-sheet').remove()
        })
      </script>`)
    const freeTextUniversity = page.locator('#university-input')
    await freeTextUniversity.fill('Городской университет Гонконга')
    await acceptEducationFreeText(page, freeTextUniversity)
    assert.equal(await page.locator('#university-sheet').count(), 0)
    assert.equal(await page.locator('#saved-university').inputValue(),
      'Городской университет Гонконга')

    await page.setContent(`
      <style>
        #late-cookie { display: none; position: fixed; inset: 0; z-index: 20; background: white; }
      </style>
      <button id="late-cookie-target">Сохранить</button>
      <aside id="late-cookie">
        <p>Чтобы сайт был удобнее, используем cookies</p>
        <button role="button">Понятно</button>
      </aside>
      <script>
        const target = document.querySelector('#late-cookie-target')
        const notice = document.querySelector('#late-cookie')
        target.addEventListener('pointerover', () => { notice.style.display = 'block' }, { once: true })
        notice.querySelector('button').addEventListener('click', () => notice.remove())
        target.addEventListener('click', () => { window.lateTargetClicked = true })
      </script>`)
    await page.locator('#late-cookie-target').click()
    assert.equal(await page.locator('#late-cookie').count(), 0)
    assert.equal(await page.evaluate(() => Boolean((window as any).lateTargetClicked)), true)

    await page.setContent(`
      <button id="unrelated-understood">Понятно</button>
      <button id="ordinary-target">Продолжить</button>
      <script>
        document.querySelector('#unrelated-understood').addEventListener('click', () => {
          window.unrelatedClicked = true
        })
        document.querySelector('#ordinary-target').addEventListener('click', () => {
          window.ordinaryTargetClicked = true
        })
      </script>`)
    await page.locator('#ordinary-target').click()
    assert.equal(await page.evaluate(() => Boolean((window as any).unrelatedClicked)), false)
    assert.equal(await page.evaluate(() => Boolean((window as any).ordinaryTargetClicked)), true)

    await page.setContent(`
      <aside><p>Чтобы сайт был удобнее, используем cookies</p></aside>
      <button id="blocked-cookie-target">Продолжить</button>`)
    await page.locator('#blocked-cookie-target').click({ timeout: 1000 }).catch(() => undefined)
    await page.waitForTimeout(300)
    assert.equal(hhCookieConsentFailure(page.context())?.code,
      'profile_hh_cookie_consent_blocked')

    const additionalPage = await page.context().newPage()
    try {
      await additionalPage.setContent(`
        <aside id="new-page-cookie">
          <p>Чтобы сайт был удобнее, используем cookies</p>
          <button>Понятно</button>
        </aside>
        <button id="new-page-target">Дальше</button>
        <script>
          document.querySelector('#new-page-cookie button').addEventListener('click', () => {
            document.querySelector('#new-page-cookie').remove()
          })
          document.querySelector('#new-page-target').addEventListener('click', () => {
            window.newPageTargetClicked = true
          })
      </script>`)
      await additionalPage.locator('#new-page-target').click()
      await additionalPage.locator('#new-page-cookie').waitFor({ state: 'detached' })
      assert.equal(await additionalPage.locator('#new-page-cookie').count(), 0)
      assert.equal(await additionalPage.evaluate(
        () => Boolean((window as any).newPageTargetClicked)), true)
    } finally {
      await additionalPage.close()
    }

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

    // Some HH layouts expose one masked birthday input. Repository fallbacks
    // use YYYY-MM-DD and must be converted before the mask receives them.
    await page.setContent('<input name="birthday" aria-label="Birth date">')
    assert.equal(await fillBirthDate(page, '2003-06-10'), true)
    assert.equal(await page.locator('input[name="birthday"]').inputValue(), '10.06.2003')

    await page.setContent(`
      <input name="birthday" aria-label="Birth date">
      <script>
        document.querySelector('input').addEventListener('input', event => {
          if (event.target.value === '10.06.2003') event.target.value = '20.03.0610'
        })
      </script>`)
    await assert.rejects(() => fillBirthDate(page, '2003-06-10'), (error: any) =>
      error?.code === 'profile_hh_birth_date_not_selected')

    await page.setContent(`
      <section data-qa="resume-profile-screen resume-profile-screen_educations">
        <label data-qa="cell"><input type="checkbox" checked>1<br>2026 · Высшее</label>
        <label data-qa="cell"><input type="checkbox">Казанский национальный исследовательский
          технический университет (КАИ)<br>2018 · Бакалавр</label>
      </section>`)
    assert.equal(await syncResumeEducationSelection(page, [{
      institution: 'Казанский национальный исследовательский технический университет (КАИ)',
      degree: 'Бакалавр компьютерных наук', graduationYear: 2018
    }]), true)
    assert.equal(await page.locator('input').nth(0).isChecked(), true, 'preserve existing education outside the CV')
    assert.equal(await page.locator('input').nth(1).isChecked(), true)

    await page.setContent(`
      <section data-qa="resume-profile-screen resume-profile-screen_educations">
        <label data-qa="cell"><input type="checkbox">Same University<br>2020 · Бакалавр</label>
        <label data-qa="cell"><input type="checkbox">Same University<br>2022 · Магистр</label>
        <label data-qa="cell"><input type="checkbox" checked>Same University<br>2010 · Высшее</label>
      </section>`)
    assert.equal(await syncResumeEducationSelection(page, [
      { institution: 'Same University', degree: 'Бакалавр', graduationYear: 2020 },
      { institution: 'Same University', degree: 'Магистр', graduationYear: 2022 }
    ]), true)
    assert.deepEqual(await page.locator('input').evaluateAll(es => es.map(e => (e as HTMLInputElement).checked)),
      [true, true, true])

    await page.setContent(`<div id="loading"></div><script>
      setTimeout(() => { document.querySelector('#loading').innerHTML =
        '<section data-qa="resume-profile-screen_experience"><label data-qa="cell">' +
        '<input type="checkbox" checked>Cognigy<br>Senior Go Engineer</label></section>' }, 1000)
    </script>`)
    assert.equal(await syncResumeExperienceSelection(page, [{company: 'Cognigy',
      title: 'Senior Go Engineer', current: true, description: '', technologies: [],
      namedOrganizations: []}], true), true)

    await page.setContent(`
      <section data-qa="resume-profile-screen resume-profile-screen_experience">
        <label data-qa="cell" data-result="false"><input type="checkbox" checked>1<br>January 2020 — now</label>
        <label data-qa="cell" data-result="true"><input type="checkbox">Senior Python Developer</label>
        <label data-qa="cell"><input type="checkbox" checked>Raiffeisen Bank<br>Backend Developer</label>
        <label data-qa="cell" data-result="true"><input type="checkbox">Yandex<br>Python Developer</label>
      </section>`)
    const experience = [
      { company: 'Jungle Scout', title: 'Senior Python Developer', current: false,
        description: 'Built services.', technologies: [], namedOrganizations: [] },
      { company: 'Raiffeisen Bank', title: 'Backend Developer', current: false,
        description: 'Built APIs.', technologies: [], namedOrganizations: [] },
      { company: 'Yandex', title: 'Python Developer', current: true,
        description: 'Built platforms.', technologies: [], namedOrganizations: [] }
    ]
    assert.equal(await syncResumeExperienceSelection(page, experience), true)
    assert.deepEqual(await page.locator('input').evaluateAll(inputs =>
      inputs.map(input => (input as HTMLInputElement).checked)), [true, true, true, true])
    assert.equal(await syncResumeExperienceSelection(page, experience, true), true)

    await page.setContent(`
      <section data-qa="resume-profile-screen resume-profile-screen_experience">
        <label data-qa="cell" data-result="false"><input type="checkbox" checked>1<br>January 2020 — now</label>
        <label data-qa="cell" data-result="true"><input type="checkbox">Senior Python Developer</label>
        <label data-qa="cell"><input type="checkbox" checked>Raiffeisen Bank<br>Backend Developer</label>
        <label data-qa="cell" data-result="true"><input type="checkbox">Yandex<br>Python Developer</label>
      </section>
      <script>
        document.querySelectorAll('label[data-qa="cell"]').forEach(label => {
          label.addEventListener('click', event => {
            event.preventDefault()
            setTimeout(() => {
              const replacement = label.cloneNode(true)
              replacement.querySelector('input').checked = label.dataset.result === 'true'
              label.replaceWith(replacement)
            }, 600)
          }, { once: true })
        })
      </script>`)
    assert.equal(await syncResumeExperienceSelection(page, experience), true)
    assert.deepEqual(await page.locator('input').evaluateAll(inputs =>
      inputs.map(input => (input as HTMLInputElement).checked)), [true, true, true, true])

    await page.setContent(`
      <section data-qa="resume-profile-screen resume-profile-screen_experience">
        <label data-qa="cell"><input type="checkbox" checked>Jungle Scout</label>
      </section>`)
    await assert.rejects(() => syncResumeExperienceSelection(page, experience, true),
      (error: any) => error?.code === 'profile_hh_experience_not_found')

    // A generic title must not match a different card only because it is a
    // substring of that card's longer title.
    await page.setContent(`
      <section data-qa="resume-profile-screen resume-profile-screen_experience">
        <label data-qa="cell"><input type="checkbox" checked>PandaDoc<br>Python Backend-разработчик</label>
      </section>`)
    await assert.rejects(() => syncResumeExperienceSelection(page, [
      { company: 'PandaDoc', title: 'Python Backend-разработчик', current: false,
        description: 'Built APIs.', technologies: [], namedOrganizations: [] },
      { company: 'Kaspi.kz', title: 'Backend-разработчик', current: false,
        description: 'Built services.', technologies: [], namedOrganizations: [] }
    ], true), (error: any) => error?.code === 'profile_hh_experience_not_found')

    await page.setContent(`
      <section data-qa="bottom-sheet-content">
        <button data-qa="modal-edit-list-item-save">Сохранить</button>
      </section>
      <section id="responsibilities" data-qa="bottom-sheet-content">
        <h2>Чем занимались?</h2>
        <textarea>Описание опыта</textarea>
      </section>
      <section id="position-behind" data-qa="bottom-sheet-content">
        <h2>Должность</h2>
      </section>
      <footer id="responsibilities-footer">
        <button id="responsibilities-save">Сохранить</button>
      </footer>
      <script>
        document.querySelector('#responsibilities-save').addEventListener('click', () => {
          window.responsibilitiesSaved = true
          document.querySelector('#responsibilities').remove()
          document.querySelector('#responsibilities-footer').remove()
          const replacement = document.createElement('section')
          replacement.id = 'position-replacement'
          replacement.dataset.qa = 'bottom-sheet-content'
          replacement.textContent = 'Должность'
          document.body.append(replacement)
        })
        document.querySelector('[data-qa="modal-edit-list-item-save"]')
          .addEventListener('click', () => { window.mainExperienceSaved = true })
      </script>`)
    assert.equal(await saveExperienceResponsibilitiesEditor(page), true)
    assert.equal(await page.evaluate(() => Boolean((window as any).responsibilitiesSaved)), true)
    assert.equal(await page.evaluate(() => Boolean((window as any).mainExperienceSaved)), false)

    await page.setContent(`
      <header id="responsibilities-heading">
        <div>Чем занимались?<span>Обязанности и достижения</span></div>
      </header>
      <section id="responsibilities-content" data-qa="bottom-sheet-content">
        <textarea>Описание опыта</textarea>
      </section>
      <footer id="responsibilities-footer">
        <button id="responsibilities-save">Сохранить</button>
      </footer>
      <script>
        document.querySelector('#responsibilities-save').addEventListener('click', () => {
          window.portalledResponsibilitiesSaved = true
          document.querySelector('#responsibilities-heading').remove()
          document.querySelector('#responsibilities-content').remove()
          document.querySelector('#responsibilities-footer').remove()
        })
      </script>`)
    assert.equal(await saveExperienceResponsibilitiesEditor(page), true)
    assert.equal(await page.evaluate(() => Boolean(
      (window as any).portalledResponsibilitiesSaved)), true)

    await page.setContent(`
      <section data-qa="bottom-sheet-content">
        <textarea>Описание опыта без доступного заголовка</textarea>
      </section>
      <footer id="responsibilities-footer">
        <button id="responsibilities-save">Сохранить</button>
      </footer>
      <script>
        document.querySelector('#responsibilities-save').addEventListener('click', () => {
          window.headinglessResponsibilitiesSaved = true
          document.querySelector('#responsibilities-footer').remove()
        })
      </script>`)
    assert.equal(await saveExperienceResponsibilitiesEditor(page), true)
    assert.equal(await page.evaluate(() => Boolean(
      (window as any).headinglessResponsibilitiesSaved)), true)

    await page.setContent(`
      <main><button data-qa="resume-list-action-more">Меню резюме</button></main>
      <div id="stale-contacts-overlay">
        <p>Контакты в резюме могли устареть</p>
        <button id="replace-contacts">Заменить на новые из профиля</button>
        <button id="close-stale-contacts">Закрыть</button>
      </div>
      <script>
        document.querySelector('#replace-contacts').addEventListener('click', () => {
          window.staleContactsReplaced = true
        })
        document.querySelector('#close-stale-contacts').addEventListener('click', () => {
          window.staleContactsClosed = true
          document.querySelector('#stale-contacts-overlay').remove()
        })
      </script>`)
    assert.equal(await dismissStaleResumeContactsPrompt(page), true)
    assert.equal(await page.evaluate(() => Boolean((window as any).staleContactsClosed)), true)
    assert.equal(await page.evaluate(() => Boolean((window as any).staleContactsReplaced)), false)

    await page.setContent(`
      <section id="position-editor" data-qa="bottom-sheet-content">
        <h2>Должность</h2>
        <input value="Senior Python-инженер">
        <button aria-label="Закрыть"></button>
      </section>
      <script>
        document.querySelector('[aria-label="Закрыть"]').addEventListener('click', () => {
          window.positionEditorClosed = true
          document.querySelector('#position-editor').remove()
        })
      </script>`)
    assert.equal(await closeExperienceTextEditor(page, /^(?:Должность|Position)$/i), true)
    assert.equal(await page.evaluate(() => Boolean((window as any).positionEditorClosed)), true)

    await page.setContent(`
      <section id="company-editor" data-qa="bottom-sheet-content">
        <h2>Company name</h2>
      </section>
      <input id="company-input" value="Bolt">
      <footer><button id="company-save">Save</button></footer>
      <script>
        document.querySelector('#company-save').addEventListener('click', () => {
          window.companyEditorSaved = true
          document.querySelector('#company-editor').remove()
        })
      </script>`)
    await acceptExperienceFreeText(page, page.locator('#company-input'))
    assert.equal(await page.evaluate(() => Boolean((window as any).companyEditorSaved)), true)

    await page.setContent(`
      <section id="company-editor" data-qa="bottom-sheet-content">
        <h2>Company name</h2>
      </section>
      <input id="company-input" value="Bolt">
      <script>
        document.querySelector('#company-input').addEventListener('keydown', event => {
          if (event.key === 'Escape') document.querySelector('#company-editor').remove()
        })
      </script>`)
    await acceptExperienceFreeText(page, page.locator('#company-input'))
    assert.equal(await page.locator('#company-editor').count(), 0)
    assert.equal(await page.locator('#company-input').inputValue(), 'Bolt')

    await page.setContent(`
      <style>
        #month-control { position: fixed; left: 20px; top: 100px; width: 200px; height: 40px; }
        #late-position-overlay { position: fixed; inset: 0; z-index: 20; background: white; }
      </style>
      <div id="month-owner" data-qa="bottom-sheet-css-variables">
        <button id="month-control">Месяц</button>
      </div>
      <div id="late-position-overlay" data-qa="bottom-sheet-css-variables">
        Должность
        <button aria-label="Закрыть"></button>
      </div>
      <script>
        document.querySelector('#late-position-overlay button').addEventListener('click', () => {
          document.querySelector('#late-position-overlay').remove()
        })
      </script>`)
    assert.equal(await dismissExperienceOverlayBlocking(
      page, page.locator('#month-control')), true)
    assert.equal(await page.locator('#late-position-overlay').count(), 0)

    await page.setContent(`
      <label><input type="checkbox" name="resume-a" checked disabled>Resume A</label>
      <label><input type="checkbox" name="resume-b">Resume B</label>
      <label><input type="checkbox" name="resume-c">Resume C</label>
      <label><input type="checkbox" name="unrelated" checked>Unrelated resume</label>`)
    assert.equal(await setExperienceResumePropagation(page,
      ['resume-a', 'resume-b', 'resume-c']), true)
    assert.deepEqual(await page.locator('input').evaluateAll(inputs =>
      inputs.map(input => (input as HTMLInputElement).checked)), [true, true, true, false])

    await page.setContent(`
      <label><input type="checkbox" checked>Работаю сейчас</label>
      <label><input type="checkbox" checked>Старший Python разработчик</label>
      <label><input type="checkbox">Старший Backend разработчик</label>`)
    assert.equal(await setExperienceResumePropagation(page,
      ['resume-a', 'resume-b']), true)
    assert.deepEqual(await page.locator('input').evaluateAll(inputs =>
      inputs.map(input => (input as HTMLInputElement).checked)), [true, true, true])

    await page.setContent(`
      <section><h2>Языки</h2>
        <article id="saved-english"><div>Английский</div>
          <div>B2 — Средне-продвинутый</div><span>›</span></article>
        <button id="saved-language-add">Добавить</button>
      </section>
      <script>
        document.querySelector('#saved-english').addEventListener('click', () => {
          window.savedEnglishClicked = true
        })
        document.querySelector('#saved-language-add').addEventListener('click', () => {
          window.savedLanguageAddClicked = true
        })
      </script>`)
    await syncProfileLanguages(page, [{ name: 'Английский', level: 'B2' }])
    assert.equal(await page.evaluate(() => Boolean((window as any).savedEnglishClicked)), false)
    assert.equal(await page.evaluate(() => Boolean((window as any).savedLanguageAddClicked)), false)

    // The current HH profile UI renders nested clickable cards without data-qa.
    // Its modal has two dropdowns, and the language list must be searched.
    await page.setContent(`
      <button data-qa="lang-switch-button" role="combobox"
        aria-label="Выбор языка сайта">Русский</button>
      <section id="languages-editor">
        <h2>Языки</h2>
        <article id="english-card"><div><span>Английский</span></div>
          <div><span id="english-level">B1 — Средний</span></div><span>›</span></article>
        <article id="spanish-card"><div><span>Испанский</span></div>
          <div><span>B2 — Средне-продвинутый</span></div><span>›</span></article>
        <button data-qa="profile-language-add">+ Добавить</button>
        <div id="dropdown-language-form" data-qa="bottom-sheet-content" hidden>
          <h3>Язык</h3>
          <button id="language-dropdown" role="combobox">Язык</button>
          <button id="level-dropdown" role="combobox">Уровень владения</button>
          <div id="dropdown-options" data-qa="bottom-sheet-css-variables"
            role="listbox" hidden></div>
          <button data-qa="profile-layout-save-button">Сохранить</button>
        </div>
      </section>
      <div id="level-portal" hidden>
        <h3>Уровень владения</h3><input type="search">
        <div id="level-portal-options"></div>
      </div>
      <script>
        const dropdownForm = document.querySelector('#dropdown-language-form')
        const dropdownOptions = document.querySelector('#dropdown-options')
        const levelPortal = document.querySelector('#level-portal')
        let selectedLanguage = ''
        let selectedLevel = ''
        let editedCard = null
        document.querySelector('[data-qa="lang-switch-button"]').addEventListener('click', () => {
          window.siteLanguageSwitchClicked = true
        })
        document.querySelector('#english-card').addEventListener('click', () => {
          window.englishCardClicks = (window.englishCardClicks || 0) + 1
          editedCard = document.querySelector('#english-card')
          selectedLanguage = 'Английский'
          dropdownForm.hidden = false
        })
        document.querySelector('[data-qa="profile-language-add"]').addEventListener('click', () => {
          window.languageAddClicks = (window.languageAddClicks || 0) + 1
          editedCard = null
          dropdownForm.hidden = false
        })
        function showOptions(values, kind) {
          dropdownOptions.innerHTML = (kind === 'level' ? '<input type="search">' : '') +
            values.map(value => '<button ' + (kind === 'language' ? 'role="option"' : '') +
              '>' + value + '</button>').join('')
          dropdownOptions.hidden = false
          dropdownOptions.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
            const value = button.textContent
            if (kind === 'language') {
              selectedLanguage = value
              document.querySelector('#language-dropdown').textContent = value
            } else {
              selectedLevel = value
              document.querySelector('#level-dropdown').textContent = value
            }
            dropdownOptions.hidden = true
          }))
        }
        document.querySelector('#language-dropdown').addEventListener('click', () => {
          dropdownOptions.innerHTML = '<input type="search"><button role="option">Абазинский</button>'
          dropdownOptions.hidden = false
          dropdownOptions.querySelector('input').addEventListener('input', event => {
            if (event.target.value === 'Немецкий') showOptions(['Немецкий'], 'language')
          })
        })
        document.querySelector('#level-dropdown').addEventListener('click', () => {
          levelPortal.hidden = false
          const values = ['A2 — Начальный', 'B2 — Средне-продвинутый', 'C1 — Продвинутый']
          levelPortal.querySelector('#level-portal-options').innerHTML = values.map(value =>
            '<div class="level-row">' + value + '</div>').join('')
          levelPortal.querySelectorAll('.level-row').forEach(row => row.addEventListener('click', () => {
            selectedLevel = row.textContent
            document.querySelector('#level-dropdown').textContent = selectedLevel
            levelPortal.hidden = true
          }))
        })
        document.querySelector('[data-qa="profile-layout-save-button"]').addEventListener('click', () => {
          if (editedCard) {
            editedCard.querySelector('#english-level').textContent = selectedLevel
          } else {
            const row = document.createElement('article')
            row.id = 'german-card'
            row.innerHTML = '<div><span>' + selectedLanguage + '</span></div>' +
              '<div><span>' + selectedLevel + '</span></div><span>›</span>'
            document.querySelector('[data-qa="profile-language-add"]').before(row)
          }
          dropdownForm.hidden = true
        })
      </script>`)
    await syncProfileLanguages(page, [
      { name: 'Английский', level: 'C1' },
      { name: 'Немецкий', level: 'A2' }
    ])
    assert.equal(await page.evaluate(() => Boolean((window as any).siteLanguageSwitchClicked)), false)
    assert.equal(await page.evaluate(() => (window as any).englishCardClicks), 1)
    assert.equal(await page.evaluate(() => (window as any).languageAddClicks), 1)
    assert.match(await page.locator('#english-card').innerText(), /C1 — Продвинутый/)
    assert.match(await page.locator('#german-card').innerText(), /Немецкий.*A2 — Начальный/s)
    assert.equal(await page.locator('#spanish-card').count(), 1)
    await syncProfileLanguages(page, [
      { name: 'Английский', level: 'C1' },
      { name: 'Немецкий', level: 'A2' }
    ])
    assert.equal(await page.evaluate(() => (window as any).englishCardClicks), 1)
    assert.equal(await page.evaluate(() => (window as any).languageAddClicks), 1)
    assert.equal(await page.locator('#languages-editor article')
      .filter({ hasText: 'Немецкий' }).count(), 1)

    async function expectLanguageFailure(mode: string, code: string) {
      await page.setContent(`
        <section data-mode="${mode}">
          <h2>Языки</h2>
          <button id="failure-add">Добавить</button>
          <div id="failure-form" data-qa="bottom-sheet-content" hidden>
            <button id="failure-language" role="combobox">Язык</button>
            <button id="failure-level" role="combobox">Уровень владения</button>
            <div id="failure-options" role="listbox" hidden></div>
            <button data-qa="profile-layout-save-button">Сохранить</button>
          </div>
        </section>
        <script>
          ;(() => {
          const mode = document.querySelector('section').dataset.mode
          const form = document.querySelector('#failure-form')
          const options = document.querySelector('#failure-options')
          document.querySelector('#failure-add').addEventListener('click', () => {
            form.hidden = false
          })
          document.querySelector('#failure-language').addEventListener('click', () => {
            options.hidden = false
            if (mode === 'search_missing') {
              options.innerHTML = '<button role="option">Абазинский</button>'
              return
            }
            options.innerHTML = '<input type="search"><button role="option">Абазинский</button>'
            options.querySelector('input').addEventListener('input', event => {
              if (mode === 'option_missing') return
              options.innerHTML = '<button role="option">Английский</button>'
              options.querySelector('button').addEventListener('click', () => {
                document.querySelector('#failure-language').textContent = 'Английский'
                options.hidden = true
              })
            })
          })
          document.querySelector('#failure-level').addEventListener('click', () => {
            options.hidden = false
            options.innerHTML = '<button role="option">' +
              (mode === 'level_missing' ? 'A1 — Начальный' : 'B2 — Средне-продвинутый') +
              '</button>'
            options.querySelector('button').addEventListener('click', () => {
              document.querySelector('#failure-level').textContent = options.textContent
              options.hidden = true
            })
          })
          document.querySelector('[data-qa="profile-layout-save-button"]')
            .addEventListener('click', () => { form.hidden = true })
          })()
        </script>`)
      await assert.rejects(() => syncProfileLanguages(page, [
        { name: 'Английский', level: 'B2' }
      ]), (error: any) => error?.code === code)
    }

    await expectLanguageFailure('search_missing', 'profile_hh_language_search_missing')
    await expectLanguageFailure('option_missing', 'profile_hh_language_option_missing')
    await expectLanguageFailure('level_missing', 'profile_hh_language_level_missing')
    await expectLanguageFailure('not_persisted', 'profile_hh_language_not_persisted')

    await page.setContent('<section><h2>Языки</h2></section>')
    await assert.rejects(() => syncProfileLanguages(page, [
      { name: 'Английский', level: 'B2' }
    ]), (error: any) => error?.code === 'profile_hh_language_editor_missing')

    const resumeListUrl = 'https://hh.ru/applicant/profile/me'
    await page.unroute('**/*')
    await page.route(resumeListUrl, route => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: `
      <div id="other-resume">
        <a href="/profile/resume?resume=other">Другое резюме</a><button>Удалить</button>
      </div>
      <div id="old-resume">
        <a href="/profile/resume?resume=old-resume-id">Начинающий специалист</a>
        <button id="old-delete">Удалить</button>
      </div>
      <div id="delete-confirmation" hidden>
        <p>Вы уверены, что хотите удалить резюме?</p>
        <button>Удалить</button>
      </div>
      <script>
        document.querySelector('#other-resume button').addEventListener('click', () => {
          window.wrongResumeDeleteClicked = true
        })
        document.querySelector('#old-delete').addEventListener('click', () => {
          window.oldResumeDeleteClicked = true
          document.querySelector('#delete-confirmation').hidden = false
        })
        document.querySelector('#delete-confirmation button').addEventListener('click', () => {
          window.oldResumeDeleteConfirmed = true
        })
      </script>` }))
    await page.goto(resumeListUrl)
    assert.equal(await page.locator('#old-resume').count(), 1)
    assert.equal(await page.locator('#old-delete').count(), 1)
    await deleteResume(page, { id: 'old-resume-id', title: 'Начинающий специалист',
      href: `${resumeListUrl}?resume=old-resume-id`, isDraft: false })
    assert.equal(await page.evaluate(() => Boolean((window as any).wrongResumeDeleteClicked)), false)
    assert.equal(await page.evaluate(() => Boolean((window as any).oldResumeDeleteClicked)), true)
    assert.equal(await page.evaluate(() => Boolean((window as any).oldResumeDeleteConfirmed)), true)
    await page.unroute(resumeListUrl)

    // A published resume can expose deletion only through its own action menu,
    // while a sibling draft has a directly visible Delete button. Never climb
    // to their shared container and click the sibling action.
    await page.route(resumeListUrl, route => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: `
      <main>
        <div id="draft-card">
          <a href="/profile/resume?resume=draft-id">FastAPI draft</a>
          <button id="draft-delete">Удалить</button>
        </div>
        <div id="published-card">
          <a href="/resume/published-id">Начинающий специалист</a>
          <button data-qa="resume-list-action-more" id="published-menu">Ещё</button>
        </div>
      </main>
      <div role="menu" id="published-actions" hidden><button>Удалить</button></div>
      <div role="dialog" id="published-confirmation" hidden><button>Удалить</button></div>
      <script>
        document.querySelector('#draft-delete').addEventListener('click', () => {
          window.wrongDraftDeleteClicked = true
        })
        document.querySelector('#published-menu').addEventListener('click', () => {
          document.querySelector('#published-actions').hidden = false
        })
        document.querySelector('#published-actions button').addEventListener('click', () => {
          window.publishedDeleteClicked = true
          document.querySelector('#published-confirmation').hidden = false
        })
        document.querySelector('#published-confirmation button').addEventListener('click', () => {
          window.publishedDeleteConfirmed = true
        })
      </script>` }))
    await deleteResume(page, { id: 'published-id', title: 'Начинающий специалист',
      href: `${resumeListUrl}/published-id`, isDraft: false })
    assert.equal(await page.evaluate(() => Boolean((window as any).wrongDraftDeleteClicked)), false)
    assert.equal(await page.evaluate(() => Boolean((window as any).publishedDeleteClicked)), true)
    assert.equal(await page.evaluate(() => Boolean((window as any).publishedDeleteConfirmed)), true)
    await page.unroute(resumeListUrl)

    // HH can redirect the compact profile route straight to the only published
    // resume. In that layout its three-dot menu is the first button after the
    // Download control and has no data-qa of its own.
    const directResumeUrl = 'https://hh.ru/resume/publisheddirectid'
    const directResumeFixture = `
      <html><head><title>Начинающий специалист</title></head><body>
      <h1>Начинающий специалист</h1>
      <div><button data-qa="resume-download-button"></button></div>
      <div><button id="direct-menu"></button></div>
      <div id="direct-actions" hidden><span id="direct-delete">Удалить</span></div>
      <div role="dialog" id="direct-confirmation" hidden><button>Удалить</button></div>
      <script>
        history.replaceState({}, '', '/resume/publisheddirectid')
        document.querySelector('#direct-menu').addEventListener('click', () => {
          document.querySelector('#direct-actions').hidden = false
        })
        document.querySelector('#direct-delete').addEventListener('click', () => {
          window.directDeleteClicked = true
          document.querySelector('#direct-confirmation').hidden = false
        })
        document.querySelector('#direct-confirmation button').addEventListener('click', () => {
          window.directDeleteConfirmed = true
        })
      </script></body></html>`
    await page.route(resumeListUrl, route => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: directResumeFixture }))
    await page.route(directResumeUrl, route => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: directResumeFixture }))
    await deleteResume(page, { id: 'publisheddirectid', title: 'Начинающий специалист',
      href: directResumeUrl, isDraft: false })
    assert.equal(await page.evaluate(() => Boolean((window as any).directDeleteClicked)), true)
    assert.equal(await page.evaluate(() => Boolean((window as any).directDeleteConfirmed)), true)
    await page.unroute(resumeListUrl)
    await page.unroute(directResumeUrl)
    await page.route('**/*', route => route.abort())

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

    // The selected city is also rendered behind HH's bottom sheet. Selection
    // must stay scoped to the sheet instead of clicking that duplicate text.
    await page.setContent(`
      <section data-qa="resume-profile-screen resume-profile-screen_common">
        <span id="saved-city">Москва</span>
        <input data-qa="profile-common-edit-area" value="">
        <div id="city-sheet" data-qa="bottom-sheet-css-variables">
          <h2>Город или регион проживания</h2>
          <button role="option" data-qa="cell-left-side">Москва</button>
        </div>
      </section>
      <script>
        document.querySelector('[role="option"]').addEventListener('click', () => {
          window.citySuggestionSelected = true
          document.querySelector('#city-sheet').remove()
        })
      </script>`)
    await setArea(page, 'Москва, Россия')
    assert.equal(await page.evaluate(() => Boolean((window as any).citySuggestionSelected)), true)
    assert.equal(await page.locator('#city-sheet').count(), 0)

    // Resume content is English, but the HH taxonomy follows the Russian UI.
    await page.setContent(`
      <input data-qa="profile-common-edit-area" value="">
      <div id="tbilisi-sheet" data-qa="bottom-sheet-css-variables">
        <h2>Город или регион проживания</h2>
        <div role="option" data-qa="cell-left-side">Тбилиси</div>
      </div>
      <script>
        document.querySelector('[role="option"]').addEventListener('click', () => {
          document.querySelector('[data-qa="profile-common-edit-area"]').value = 'Тбилиси'
          document.querySelector('#tbilisi-sheet').remove()
        })
      </script>`)
    await setArea(page, 'Tbilisi, Georgia')
    assert.equal(await page.locator('[data-qa="profile-common-edit-area"]').inputValue(),
      'Тбилиси')

    await page.setContent(`
      <input data-qa="profile-common-edit-area" value="Тбилиси">
      <div id="saved-tbilisi-sheet" data-qa="bottom-sheet-css-variables">
        <h2>Город или регион проживания</h2>
      </div>
      <script>
        document.addEventListener('keydown', event => {
          if (event.key === 'Escape') document.querySelector('#saved-tbilisi-sheet')?.remove()
        })
      </script>`)
    await setArea(page, 'Tbilisi, Georgia')
    assert.equal(await page.locator('#saved-tbilisi-sheet').count(), 0)
    assert.equal(await page.locator('[data-qa="profile-common-edit-area"]').inputValue(),
      'Тбилиси')

    // A matching input value is not enough: HH can still be waiting for the
    // exact result row. The zero-sized sheet root must not hide that state.
    await page.setContent(`
      <style>#matching-city-sheet { display: contents; }</style>
      <input data-qa="profile-common-edit-area" value="Москва">
      <div id="matching-city-sheet" data-qa="bottom-sheet-css-variables">
        <h2>Город или регион проживания</h2>
        <div role="option" data-qa="cell-left-side">Москва</div>
      </div>
      <script>
        document.querySelector('[role="option"]').addEventListener('click', () => {
          window.matchingCitySelected = true
          document.querySelector('#matching-city-sheet').remove()
        })
      </script>`)
    await setArea(page, 'Москва, Россия')
    assert.equal(await page.evaluate(() => Boolean((window as any).matchingCitySelected)), true)
    assert.equal(await page.locator('#matching-city-sheet').count(), 0)

    await page.setContent(`
      <input data-qa="profile-common-edit-area" value="">
      <div data-qa="bottom-sheet-css-variables">
        <h2>Город или регион проживания</h2>
        <div role="option" data-qa="cell-left-side">Троицк (Москва)</div>
      </div>`)
    await assert.rejects(async () => await setArea(page, 'Москва, Россия'),
      (error: any) => error?.code === 'profile_hh_area_not_accepted')

    // HH can accept the first button press and then open city results because
    // the text value has not been confirmed. Select the result and retry once,
    // while preserving an unrelated specialization sheet.
    await page.setContent(`
      <style>
        #racing-city-sheet { display: none; position: fixed; inset: 0; z-index: 10; background: white; }
      </style>
      <section id="racing-common"
        data-qa="resume-profile-screen resume-profile-screen_common">
        <button id="racing-next" data-qa="resume-profile-next-screen">
          Сохранить и продолжить
        </button>
      </section>
      <div id="specialization-sheet" data-qa="bottom-sheet-css-variables">
        <h2>Уточните специальность</h2>
      </div>
      <div id="racing-city-sheet" data-qa="bottom-sheet-css-variables">
        <h2>Город или регион проживания</h2>
        <div role="option" data-qa="cell-left-side">Москва</div>
      </div>
      <script>
        const next = document.querySelector('#racing-next')
        const city = document.querySelector('#racing-city-sheet')
        let racingClicks = 0
        city.querySelector('[role="option"]').addEventListener('click', () => {
          window.racingCitySelected = true
          city.remove()
        })
        next.addEventListener('click', () => {
          racingClicks += 1
          window.racingNextClicks = racingClicks
          if (racingClicks === 1) city.style.display = 'block'
          if (racingClicks === 2) {
            document.querySelector('#racing-common').dataset.qa =
              'resume-profile-screen resume-profile-screen_education'
            history.pushState({}, '', '#education')
          }
        })
      </script>`)
    await nextWizardStep(page, 'personal information', { area: 'Москва, Россия' })
    assert.equal(await page.locator('#racing-city-sheet').count(), 0)
    assert.equal(await page.locator('#specialization-sheet').count(), 1)
    assert.equal(await page.evaluate(() => Boolean((window as any).racingCitySelected)), true)
    assert.equal(await page.evaluate(() => Number((window as any).racingNextClicks)), 2)
    assert.match(String(await page.locator('#racing-common').getAttribute('data-qa')), /education/)
  } finally {
    await context.close()
    await browser.close()
  }
}
