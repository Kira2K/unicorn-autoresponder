import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { activateResume, publicationIsActive, readResumePublication, verifyActiveResume } from '../hh-activation.ts'
import { completeKnownResumeProfession, INITIAL_HH_PROFESSION } from '../hh-resume-ui.ts'

export async function runHHActivationTests() {
  assert.equal(publicationIsActive({ status: 'not_finished', isSearchable: false }), false)
  assert.equal(publicationIsActive({ status: 'not_finished', isSearchable: true }), false)
  assert.equal(publicationIsActive({ status: 'new', isSearchable: false }), false)
  assert.equal(publicationIsActive({ status: 'blocked', isSearchable: true }), false)
  assert.equal(publicationIsActive({ status: 'new', isSearchable: true }), true)
  assert.equal(publicationIsActive({ status: 'approved', isSearchable: true }), true)
  assert.equal(publicationIsActive({ status: 'modified', isSearchable: true }), true)
  assert.equal(publicationIsActive({ status: 'modified', isSearchable: false }), false)
  assert.equal(publicationIsActive({ status: 'new', isSearchable: true, hasErrors: true }), false)
  assert.equal(publicationIsActive({ status: 'unknown', isSearchable: true }), false)
  let readAttempts = 0
  const transitionPage = {
    evaluate: async () => {
      if (++readAttempts === 1) throw new Error('Execution context was destroyed, most likely because of a navigation')
      return { id: 'abc', title: 'Known title', status: 'new', isSearchable: true }
    },
    waitForLoadState: async () => undefined, waitForTimeout: async () => undefined
  }
  assert.equal((await readResumePublication(transitionPage as any,
    { id: 'abc', title: 'Known title', href: 'https://hh.ru/resume/abc', isDraft: true })).isActive, true)
  assert.equal(readAttempts, 2, 'A navigation race retries only the read, never the publication')
  let negotiationReads = 0
  const negotiationPage = { ...transitionPage, evaluate: async () => {
    if (++negotiationReads === 1) throw new Error('HH publication read failed (HTTP 406).')
    return { id: 'abc', title: 'Known title', status: 'modified', isSearchable: true }
  } }
  assert.equal((await readResumePublication(negotiationPage as any,
    { id: 'abc', title: 'Known title', href: 'https://hh.ru/resume/abc', isDraft: false })).isActive, true)
  assert.equal(negotiationReads, 2)
  const browser = await chromium.launch({ headless: true }).catch(() =>
    chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage()
    const id = 'a'.repeat(34)
    const resume = { id, title: 'Senior Python Developer', href: `https://hh.ru/resume/${id}`, isDraft: true }
    let status = 'not_finished'
    let searchable = false
    let saves = 0
    let wizardStep = 'experience'
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === `/resume/edit/${id}/position`) return route.fulfill({ json: {
        applicantResume: { _attributes: { hash: id, status, isSearchable: searchable } },
        resumeEditor: { fields: { title: resume.title } }
      } })
      if (url.pathname === '/test-publish') {
        saves += 1; status = 'new'; searchable = true
        return route.fulfill({ body: 'ok' })
      }
      if (url.pathname === '/profile/resume') return route.fulfill({
        contentType: 'text/html', body: `<script>location.replace('/profile/resume/${wizardStep}?resume=${id}')</script>`
      })
      if (url.pathname.endsWith('/professional_role')) return route.fulfill({
        contentType: 'text/html', body: '<div data-qa="resume-profile-card-select-job">Choose profession</div>'
      })
      return route.fulfill({ contentType: 'text/html', body:
        '<div data-qa="resume-profile-screen_experience"><div data-qa="form-error" style="min-height:1px"></div><button data-qa="resume-profile-next-screen" onclick="fetch(\'/test-publish\',{method:\'POST\'})">Save and continue</button></div>' })
    })
    await page.goto(`https://hh.ru/profile/resume/experience?resume=${id}`)
    await assert.rejects(activateResume(page, { ...resume, title: 'Wrong title' }),
      { code: 'profile_hh_publication_identity_mismatch' })
    assert.equal(saves, 0)
    await assert.rejects(verifyActiveResume(page, resume), { code: 'profile_hh_resume_not_active' })
    const activated = await activateResume(page, resume)
    assert.equal(activated.isActive, true)
    assert.equal(activated.isDraft, false)
    await activateResume(page, activated)
    assert.equal(saves, 1, 'Already active resumes are verified without another publishing click')
    status = 'not_finished'; searchable = false; wizardStep = 'keyskills'
    assert.equal((await activateResume(page, resume)).isActive, true)
    assert.equal(saves, 2, 'The observed HH keyskills route is a supported completion step')
    status = 'not_finished'; searchable = false
    await assert.rejects(verifyActiveResume(page, resume), { code: 'profile_hh_resume_not_active' })
    wizardStep = 'professional_role'
    let professionCompletions = 0
    const completedCopy = await activateResume(page, resume, undefined, {
      completeProfession: async (currentPage, target) => {
        assert.equal(new URL(currentPage.url()).searchParams.get('resume'), id)
        assert.equal(target.title, resume.title)
        professionCompletions += 1
        status = 'new'; searchable = true
      }
    })
    assert.equal(completedCopy.isActive, true)
    assert.equal(professionCompletions, 1, 'Saved clone title does not imply the profession wizard is complete')
    assert.equal(saves, 2)

    const professionPage = await browser.newPage()
    let savedTitle = resume.title
    let professionPublishes = 0
    await professionPage.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/test-profession-publish') {
        professionPublishes += 1; savedTitle = INITIAL_HH_PROFESSION
        return route.fulfill({ body: 'ok' })
      }
      if (url.pathname === '/test-title-save') {
        savedTitle = route.request().postData() ?? ''
        return route.fulfill({ body: 'ok' })
      }
      if (url.pathname === `/resume/edit/${id}/position`) return route.fulfill({
        contentType: 'text/html; charset=utf-8', body: `<input data-qa="resume-edit-title-suggest" value="${savedTitle}">
        <button onclick="fetch('/test-title-save',{method:'POST',body:document.querySelector('input').value}).then(()=>location.href='/resume/${id}')">Сохранить</button>`
      })
      if (url.pathname.endsWith('/professional_role')) return route.fulfill({
        contentType: 'text/html; charset=utf-8', body: `
        <input data-qa="resume-profile-position-input">
        <label><input type="radio" name="profession"><span>${INITIAL_HH_PROFESSION}</span></label>
        <button data-qa="resume-profile-next-screen" onclick="document.body.append(document.querySelector('template').content.cloneNode(true))">Сохранить и продолжить</button>
        <template><div id="sheet"><h2>Уточните специальность</h2>
        <input data-qa="tree-selector-search-input">
        <label data-qa="tree-selector-item-developer"><input hidden type="checkbox" checked><span>${INITIAL_HH_PROFESSION}</span></label>
        <button data-qa="category-modal-submit" onclick="fetch('/test-profession-publish',{method:'POST'}).then(()=>location.href='/applicant/resumes/suitable_vacancies')">Сохранить и продолжить</button></div></template>`
      })
      return route.fulfill({ contentType: 'text/html', body: '<main>Published</main>' })
    })
    await professionPage.goto(`https://hh.ru/profile/resume/professional_role?resume=${id}`)
    await completeKnownResumeProfession(professionPage, resume)
    assert.equal(professionPublishes, 1, 'Popular profession needs Continue to open the specialization sheet')
    assert.equal(savedTitle, resume.title, 'Restore the exact mapped title after the canonical profession step')
    await professionPage.close()
  } finally { await browser.close() }
}
