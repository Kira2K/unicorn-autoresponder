import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { fillExperienceCompany } from '../hh-resume-ui.ts'

export async function runHHExperienceCompanyTests() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => route.abort())
    const field = '<input id="company" data-qa="resume-profile-experience-specific-company-input">'

    // Observed desktop layout: plain company input, no suggestion or sheet.
    // Leaving the field commits the input; it must not submit the experience.
    await page.setContent(`${field}<button onclick="window.submitted=true">Save</button>
      <script>company.onblur=()=>{window.committed=company.value}</script>`)
    await fillExperienceCompany(page, 'Hyperscience')
    assert.equal(await page.locator('#company').inputValue(), 'Hyperscience')
    assert.equal(await page.evaluate(() => (window as any).committed), 'Hyperscience')
    assert.equal(await page.evaluate(() => Boolean((window as any).submitted)), false)

    // A matching current value is read, without retyping it.
    await page.setContent(`${field}<script>
      company.value='Hyperscience'; company.oninput=()=>{window.retyped=true}
      </script>`)
    await fillExperienceCompany(page, 'Hyperscience')
    assert.equal(await page.evaluate(() => Boolean((window as any).retyped)), false)

    // A similarly named suggestion must not replace the requested company.
    await page.setContent(`${field}
      <button role="option" onclick="company.value='Hyperscience Labs'">Hyperscience Labs</button>
      <button role="option" onclick="window.exact=true;company.value='Hyperscience'">Hyperscience</button>`)
    await fillExperienceCompany(page, 'Hyperscience')
    assert.equal(await page.evaluate(() => Boolean((window as any).exact)), true)

    // The existing sheet flow remains supported and verifies the underlying field.
    await page.setContent(`${field}
      <section data-qa="bottom-sheet-content" id="sheet" hidden>
        <h2>Company name</h2><input id="editor">
      </section><script>
        company.oninput=()=>{sheet.hidden=false};
        editor.onkeydown=e=>{if(e.key==='Enter'){company.value=editor.value;sheet.remove()}}
      </script>`)
    await fillExperienceCompany(page, 'Hyperscience')
    assert.equal(await page.locator('#sheet').count(), 0)
    assert.equal(await page.locator('#company').inputValue(), 'Hyperscience')

    // A field that discards the value on blur must still stop filling.
    await page.setContent(`${field}<button>Next field</button>
      <script>company.onblur=()=>{company.value=''}</script>`)
    await assert.rejects(fillExperienceCompany(page, 'Hyperscience'), {
      code: 'profile_hh_published_experience_company_not_applied'
    })

    // An exact suggestion can also fail to apply; clicking alone is not evidence.
    await page.setContent(`${field}
      <button role="option" onclick="company.value=''">Hyperscience</button>`)
    await assert.rejects(fillExperienceCompany(page, 'Hyperscience'), {
      code: 'profile_hh_published_experience_company_not_applied'
    })
  } finally { await browser.close() }
}
