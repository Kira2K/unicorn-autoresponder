import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { ensureEnglishResumeLanguage, verifyEnglishResumeLanguage } from '../hh-resume-language.ts'

export async function runHHResumeLanguageTests() {
  const browser = await chromium.launch({ headless: true }).catch(() =>
    chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage()
    const id = 'b'.repeat(34)
    const resume = { id, title: 'Senior Python Developer', href: `https://hh.ru/resume/${id}`, isDraft: false }
    let language: string | undefined = 'RU'
    let saves = 0
    let discardSave = false
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === `/resume/edit/${id}/position`) return route.fulfill({ json: {
        applicantResume: { _attributes: { hash: id, status: 'approved', isSearchable: true, lang: language } },
        resumeEditor: { fields: { title: resume.title } }
      } })
      if (url.pathname === '/test-language') {
        assert.deepEqual(route.request().postDataJSON(), { language: 'EN' })
        saves += 1
        if (!discardSave) language = 'EN'
        return route.fulfill({ body: 'ok' })
      }
      assert.equal(route.request().method(), 'GET', 'Only the resume-language update is allowed')
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <button data-qa="lang-switch-button">Русский</button><p>English C1</p>
        <h1>Senior Python Developer</h1><p>English summary text</p>
        <div data-qa="trigger-values-wrapper" onclick="menu.hidden=false">${language === 'EN' ? 'In English' : 'По-русски'}</div>
        <div id="menu" hidden><div onclick="change()">In English</div></div>
        <script>async function change(){await fetch('/test-language',{method:'POST',body:JSON.stringify({language:'EN'})});location.reload()}</script>` })
    })
    await page.goto(resume.href)
    await assert.rejects(verifyEnglishResumeLanguage(page, resume), { code: 'profile_hh_resume_language_incomplete' })
    assert.equal(saves, 0, 'English text/CEFR and a read-only check must not hide RU resume metadata')
    await assert.rejects(ensureEnglishResumeLanguage(page, { ...resume, title: 'Wrong title' }),
      { code: 'profile_hh_publication_identity_mismatch' })
    assert.equal(saves, 0)
    assert.equal(await ensureEnglishResumeLanguage(page, resume), 'EN')
    assert.equal(saves, 1)
    assert.equal(await page.locator('[data-qa="lang-switch-button"]').innerText(), 'Русский')
    assert.equal(await page.getByText('English C1', { exact: true }).count(), 1)
    await ensureEnglishResumeLanguage(page, resume)
    assert.equal(saves, 1, 'Already-English resumes must not be toggled again')
    language = 'RU'; discardSave = true
    await assert.rejects(ensureEnglishResumeLanguage(page, resume), { code: 'profile_hh_resume_language_incomplete' })
    language = undefined
    await assert.rejects(verifyEnglishResumeLanguage(page, resume), { code: 'profile_hh_resume_language_incomplete' })
  } finally { await browser.close() }
}
