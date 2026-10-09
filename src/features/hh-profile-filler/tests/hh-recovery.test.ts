import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { openExperienceSelection } from '../hh-experience-navigation.ts'
import { readEmployerList, preservedEmployerNames } from '../hh-employer-list.ts'
import { preserveFirstObservation } from '../preservation-state.ts'
import { readResumeLocation } from '../hh-location.ts'
import { readExperienceContent } from '../hh-experience-content.ts'
import { experienceContentMatches } from '../content-policy.ts'
import { syncResumeExperienceSelection, syncResumeEducationSelection, prepareDraftExperience } from '../hh-resume-ui.ts'

export async function runHHRecoveryTests() {
  const browser = await chromium.launch({ headless: true })
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-recovery-'))
  const previousRoot = process.env.PROFILE_FILLER_STORAGE_ROOT
  process.env.PROFILE_FILLER_STORAGE_ROOT = root
  try {
    const page = await browser.newPage()
    const skills = Array.from({ length: 30 }, (_, i) => `Skill ${i}`)
    let pending = true, completions = 0
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: pending ?
      `<section data-qa="resume-profile-screen_skill_levels">${skills.map(s => `<span data-qa="skillName">${s}</span>`).join('')}</section>` :
      '<section data-qa="resume-profile-screen_experience">Experience</section>' }))
    const complete = async () => { pending = false; completions++ }
    await openExperienceSelection(page, 'known', skills, complete)
    await openExperienceSelection(page, 'known', skills, complete)
    assert.equal(completions, 1)
    assert.equal(new URL(page.url()).searchParams.get('resume'), 'known')
    pending = true
    await assert.rejects(() => openExperienceSelection(page, 'known', skills.slice(1), complete),
      { code: 'profile_hh_thirty_levels_unavailable' })
    assert.equal(completions, 1)

    await page.unroute('**/*')
    let city = 'Tbilisi'
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      `<input type="hidden" name="area" value="2758"><div><input data-qa="profile-common-edit-area"><span class="magritte-value-ghost"></span></div>
      <script>setTimeout(() => document.querySelector('span').textContent = ${JSON.stringify(city)}, 350)</script>` }))
    assert.equal(await readResumeLocation(page, 'known'), 'Tbilisi')
    city = 'Berlin'
    assert.equal(await readResumeLocation(page, 'known'), 'Berlin')
    city = '2758'
    await assert.rejects(() => readResumeLocation(page, 'known'), /location_unreadable/)
    await page.unroute('**/*')
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
      `<input type="hidden" name="area" value="2758"><p>About: Tbilisi</p>
      <button data-qa="cell"><span data-qa="cell-text-content">Где живёте</span>
      <span data-qa="cell-text-content">${city} · Место не&nbsp;указано</span></button>` }))
    city = 'Тбилиси'
    assert.equal(await readResumeLocation(page, 'known', false), 'Тбилиси')
    city = 'Berlin'
    assert.equal(await readResumeLocation(page, 'known', false), 'Berlin', 'About text must not substitute for residence')
    city = '2758'
    await assert.rejects(() => readResumeLocation(page, 'known', false), /location_unreadable/)

    await page.setContent('<label data-qa="cell"><input type="checkbox" checked>All phones</label>' +
      '<div role="dialog"><input data-qa="resume-editor-employer-list-search-input">' +
      '<div data-qa="modal-content-scroll-container"><span data-qa="resume-editor-employer-list-item-1">Acme</span></div></div>')
    assert.deepEqual(await readEmployerList(page), ['Acme'])
    await page.locator('[data-qa="resume-editor-employer-list-item-1"]').evaluate(e => e.remove())
    assert.deepEqual(await readEmployerList(page), [])
    await page.setContent('<label data-qa="resume-visibility-card-hidden-fields-phones">All phones</label>')
    preserveFirstObservation('operation', 'known', 'employers', ['All phones', 'Legacy employer'])
    assert.deepEqual(await preservedEmployerNames(page, 'operation', 'known', ['Legacy employer', 'Acme']),
      ['Legacy employer', 'Acme'])
    assert.deepEqual(preserveFirstObservation('operation', 'known', 'employers', []),
      ['All phones', 'Legacy employer'], 'original evidence stays immutable')

    for (const count of [0, 1, 5]) {
      const items = Array.from({ length: count }, (_, i) => ({ company: 'Same employer', title: `Role ${i}`,
        startDate: '01/2020', endDate: '02/2021', current: false, description: '', technologies: [], namedOrganizations: [] }))
      await page.setContent('<section style="min-height:20px" data-qa="resume-profile-screen_experience">' + items.map(i =>
        `<label data-qa="cell"><input type="checkbox">${i.company}<br>${i.title}<br>January 2020 - February 2021</label>`).join('') + '</section>')
      assert.equal(await syncResumeExperienceSelection(page, items), true)
      assert.equal(await syncResumeExperienceSelection(page, items, true), true)
      assert.equal(await page.locator('input:checked').count(), count)
    }
    await page.setContent('<section data-qa="resume-profile-screen_educations">' +
      ['Bachelor', 'Master'].map(d => `<label data-qa="cell"><input type="checkbox">University<br>2020 ${d}</label>`).join('') + '</section>')
    assert.equal(await syncResumeEducationSelection(page, [
      { institution: 'University', degree: 'Bachelor of Science', graduationYear: 2020 },
      { institution: 'University', degree: 'Master of Science', graduationYear: 2020 }
    ]), true)
    assert.equal(await page.locator('input:checked').count(), 2)
    const item = { company: 'Acme', title: 'Engineer', startDate: '01/2020', current: true,
      description: 'Built APIs', technologies: [], namedOrganizations: [] }
    const draft = { id: 'known', title: 'Engineer', href: '', isDraft: true }
    await page.unroute('**/*')
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      '<div data-qa="profile-experience-company-card">Acme Engineer January 2020 - Present Built APIs</div>' }))
    const compact = '<section data-qa="resume-profile-screen_experience"><label data-qa="cell">' +
      '<input type="checkbox" checked>Engineer<br>January 2020 - Present<br>Built APIs</label></section>'
    await page.setContent(compact)
    const saved = await readExperienceContent(page, draft, [item])
    assert.equal(saved.length, 1)
    assert.equal(experienceContentMatches(saved[0], item), true)
    await page.setContent(compact.replace(' checked', ''))
    await assert.rejects(() => readExperienceContent(page, draft, [item]), /draft_experience_content_mismatch/)
    const native = { ...draft, id: 'copy', nativeSourceId: 'baseline' }
    const paths: string[] = []
    await page.unroute('**/*')
    await page.route('**/*', route => {
      paths.push(new URL(route.request().url()).pathname)
      assert.equal(route.request().method(), 'GET')
      return route.fulfill({ contentType: 'text/html', body:
        '<div data-qa="resume-list-card-experience-item-1">Acme Engineer January 2020 - Present Built APIs</div>' })
    })
    await prepareDraftExperience(page, {} as any, native)
    assert.deepEqual(paths, [], 'Preparing a native copy must not submit its potentially publishing profession step')
    const copied = await readExperienceContent(page, native, [item])
    assert.equal(experienceContentMatches(copied[0], item), true)
    assert.deepEqual(paths, ['/resume/copy/experience'], 'Verify the copy itself, never substitute baseline/profile records')
    await page.unroute('**/*')
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      '<script>history.replaceState(null,"","/profile/block/experience")</script>' +
      '<div data-qa="profile-experience-company-card">Acme Engineer January 2020 - Present Built APIs</div>' }))
    await assert.rejects(() => readExperienceContent(page, native, [item]), /resume_experience_identity_mismatch/)
    const repeated = [2020, 2022].map(year => ({ company: 'Same employer', title: 'Engineer',
      startDate: `01/${year}`, endDate: `02/${year + 1}`, current: false, description: '', technologies: [], namedOrganizations: [] }))
    await page.setContent('<section data-qa="resume-profile-screen_experience">' + [2020, 2022].map(year =>
      `<label data-qa="cell"><input type="checkbox">Same employer<br>Engineer<br>January ${year} - February ${year + 1}</label>`).join('') + '</section>')
    assert.equal(await syncResumeExperienceSelection(page, repeated), true)
    assert.equal(await page.locator('input:checked').count(), 2)
  } finally {
    await browser.close()
    if (previousRoot === undefined) delete process.env.PROFILE_FILLER_STORAGE_ROOT
    else process.env.PROFILE_FILLER_STORAGE_ROOT = previousRoot
    fs.rmSync(root, { recursive: true, force: true })
  }
}
