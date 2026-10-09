import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { makeServiceFixture } from './service-fixture.ts'
import { readResumeContract } from '../hh-contract-reader.ts'
import { ensureResumeEnglish, inspectResumeLanguage } from '../hh-resume-language.ts'
import { readPersistedSkills } from '../hh-resume-ui.ts'
import { verifiedContract } from './contract.test.ts'
import { preserveFirstObservation } from '../preservation-state.ts'

// Synthetic contract fixtures, not a claim of live HH DOM compatibility. All requests are intercepted.
export async function runContractDomTests() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-contract-dom-'))
  const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const profile = makeServiceFixture(directory).profile
    profile.cv.contacts.phone = '+12025550100'
    const context = await browser.newContext()
    await context.route('**/*', route => route.abort())
    const page = await context.newPage()
    const resume = { id: 'r1', title: profile.titles[0], isDraft: true, href: 'https://hh.ru/resume/r1' }
    let wrongAbout = false, advancedCount = 30
    let contactMode: 'normal' | 'mismatch' | 'unreadable' = 'normal'
    await page.route('https://hh.ru/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/resume/edit/r1/contacts' && contactMode !== 'normal') {
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: contactMode === 'unreadable'
          ? '<main>Contact editor has not loaded</main>'
          : '<input type="email" value="different@example.invalid"><input name="phone.formatted" value="+12025550199"><input type="checkbox" data-qa="resume-editor-preferred-contact-email-checked">' })
      }
      const values: Record<string, string> = {
        '/resume/edit/r1/position': `<input name="title" value="${resume.title}">`,
        '/resume/edit/r1/contacts': '<input type="email" value="test@example.invalid"><input name="phone.formatted"><input type="checkbox" checked data-qa="resume-editor-preferred-contact-email-checked">' +
          '<script>setTimeout(()=>document.querySelector("input[name=\\\"phone.formatted\\\"]").value="+1 202 555 0100",350)</script>',
        '/resume/edit/r1/about': `<textarea name="about">${wrongAbout ? 'Wrong' : profile.about}</textarea>`,
        '/profile/edit/common': '<input name="firstName"><input name="lastName"><input name="middleName"><input name="area" value="Тбилиси">',
        '/profile/resume/common': '<form action="/search/vacancy"><input type="hidden" name="area" value="2758"></form><input data-qa="profile-common-edit-area" value="Тбилиси">',
        '/profile/block/languages': '<div data-qa="languages-card">English B2</div>',
        '/resume/r1/experience': '<div data-qa="resume-block-experience-item">Company Engineer Description Currently</div>',
        '/applicant/profile/me': `<div data-qa="resume"><a data-qa="resume-card-link-r1" href="/resume/r1">${resume.title}</a>Черновик</div>`,
        '/resume/r1': '<div data-qa="resume" lang="en"></div><div data-qa="skills-card"><div><span data-qa="skill-level-title-3">Advanced</span>' +
          profile.cv.skills.slice(0, advancedCount).map((skill, i) => `<span data-qa="skill-tag-${i}">${skill}</span>`).join('') + '</div>' +
          profile.cv.skills.slice(advancedCount).map((skill, i) => `<span data-qa="skill-tag-other-${i}">${skill}</span>`).join('') + '</div>'
      }
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: values[url.pathname] ?? '<body>Unknown screen</body>' })
    })
    const readers = {
      async privacy() { return verifiedContract().privacy }, async workPreferences() {}, async permits() {},
      async languages() { return true }, async experienceMembership() { return true }, async educationMembership() { return true },
      skills: () => readPersistedSkills(page, 'r1')
    }
    const good = await readResumeContract(page, profile, resume, resume.title, readers)
    assert.equal(good.complete, true, JSON.stringify(good.issues))
    for (const mode of ['mismatch', 'unreadable'] as const) {
      contactMode = mode
      const advisory = await readResumeContract(page, profile, resume, resume.title, readers)
      assert.equal(advisory.complete, true, JSON.stringify(advisory.issues))
      assert.equal(advisory.checks?.contacts.status, 'warning')
      assert.match(advisory.checks?.contacts.reason ?? '', /contacts_(mismatch|unreadable)/)
      assert.equal(advisory.contentFingerprint, good.contentFingerprint,
        'Contact read uncertainty must not block copies through fingerprint comparison')
    }
    contactMode = 'normal'
    const previousStorageRoot = process.env.PROFILE_FILLER_STORAGE_ROOT
    process.env.PROFILE_FILLER_STORAGE_ROOT = directory
    profile.operationId = 'contacts-warning-recovery'
    try {
      preserveFirstObservation(profile.operationId, resume.id, 'content', {
        skills: [], silent: { phone: 'original-phone-observation' }, extraExperience: [], extraEducation: []
      })
      const recovered = await readResumeContract(page, profile, resume, resume.title, readers)
      assert.equal(recovered.complete, true, JSON.stringify(recovered.issues))
      assert.equal(recovered.checks?.contacts.reason, 'contacts_preservation_unverified')
      assert.equal(recovered.checks?.preservation.status, 'passed')
    } finally {
      delete profile.operationId
      if (previousStorageRoot === undefined) delete process.env.PROFILE_FILLER_STORAGE_ROOT
      else process.env.PROFILE_FILLER_STORAGE_ROOT = previousStorageRoot
    }
    profile.client.market = 'Ru'
    const ru = await readResumeContract(page, profile, resume, resume.title, {
      ...readers, resumeLanguage: async () => {
        await page.locator('[data-qa="resume"]').evaluateAll(nodes => nodes.forEach(node => node.remove()))
        return 'ru'
      }
    })
    assert.equal(ru.checks?.resumeLanguage.status, 'passed',
      'Verified RU server language does not depend on a legacy resume wrapper')
    const unknownLanguage = await readResumeContract(page, profile, resume, resume.title, {
      ...readers, resumeLanguage: async () => 'unknown'
    })
    assert.equal(unknownLanguage.checks?.resumeLanguage.status, 'failed')
    profile.client.market = 'En'
    wrongAbout = true
    assert.equal((await readResumeContract(page, profile, resume, resume.title, readers)).checks?.about.status, 'failed')
    wrongAbout = false; advancedCount = 29
    assert.equal((await readResumeContract(page, profile, resume, resume.title, readers)).checks?.skills.status, 'failed')

    await page.unroute('https://hh.ru/**')
    let converted = false
    await page.route('https://hh.ru/**', async route => {
      const english = new URL(route.request().url()).pathname === '/resume/english1'
      if (english) converted = true
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: english ? '<main data-qa="resume" lang="en">English resume</main>' :
        '<main data-qa="resume"><button onclick="location.href=\'/resume/english1\'">In English</button></main>' })
    })
    const english = await ensureResumeEnglish(page, resume)
    assert.equal(english.id, 'english1'); assert.equal(converted, true)
    assert.equal((await ensureResumeEnglish(page, english)).id, 'english1')
    await page.unroute('https://hh.ru/**')
    await page.route('https://hh.ru/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8',
      body: '<main data-qa="resume">Unknown language</main><footer><button>In English</button></footer>' }))
    await assert.rejects(() => ensureResumeEnglish(page, resume), /not unambiguously available/)
    assert.equal(await inspectResumeLanguage(page), 'unknown')
  } finally { await browser.close(); fs.rmSync(directory, { recursive: true, force: true }) }
}
