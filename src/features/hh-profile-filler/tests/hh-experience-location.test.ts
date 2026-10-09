import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { ensureExperienceLocations } from '../hh-experience-location.ts'

export async function runExperienceLocationTests() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    let description = 'Built APIs. Retained manual detail.', saves = 0
    const item = { company: 'Acme', title: 'Engineer', current: false, description: 'Built APIs.',
      location: 'United States – Remote', technologies: [], namedOrganizations: [] }
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/saved') { description = url.searchParams.get('description')!; saves++ }
      const body = url.pathname === '/profile/block/experience'
        ? `<div data-qa="profile-experience-company-card">Acme Engineer ${description}<button data-qa="edit-experience-button-0" onclick="location.href='/editor'">Edit</button></div>`
        : url.pathname === '/editor'
          ? `<input name="company" value="Acme"><input name="position" value="Engineer"><textarea data-qa="resume-editor-experience-description-input">${description}</textarea><button data-qa="profile-layout-save-button" onclick="location.href='/saved?description='+encodeURIComponent(document.querySelector('textarea').value)">Save</button>`
          : '<body>Saved</body>'
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body })
    })
    await ensureExperienceLocations(page, [item])
    assert.equal(description, 'United States – Remote\n\nBuilt APIs. Retained manual detail.')
    await ensureExperienceLocations(page, [item])
    assert.equal(saves, 1, 'repeat recovery does not append or save twice')
    await assert.rejects(() => ensureExperienceLocations(page, [{ ...item, company: 'Other' }]),
      { code: 'profile_hh_experience_ambiguous' })
    assert.equal(saves, 1)
  } finally { await browser.close() }
}
