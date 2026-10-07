import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { ensureActiveJobSearchStatus, verifyActiveJobSearchStatus } from '../hh-job-search-status.ts'

export async function runHHJobSearchStatusTests() {
  const browser = await chromium.launch({ headless: true }).catch(() =>
    chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage()
    let status = 'looking_for_offers'
    let writes = 0
    let discardSave = false
    await page.route('**/*', async route => {
      if (new URL(route.request().url()).pathname === '/test-search-status') {
        assert.deepEqual(route.request().postDataJSON(), { status: 'active_search' })
        writes += 1
        if (!discardSave) status = 'active_search'
        return route.fulfill({ body: 'ok' })
      }
      assert.equal(route.request().method(), 'GET')
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <div data-qa="applicant-profile-job-search-status-trigger" onclick="dialog.hidden=false">
          <span data-qa="applicant-profile-job-search-status-value">${status === 'active_search' ? 'Активно ищу работу' : 'Рассматриваю предложения'}</span>
        </div><div id="dialog" role="dialog" hidden>
          <label onclick="change()"><input type="radio" name="job_search_status" value="active_search"
            ${status === 'active_search' ? 'checked' : ''}>Активно ищу работу</label>
        </div><script>
          async function change(){await fetch('/test-search-status',{method:'POST',body:JSON.stringify({status:'active_search'})});
            document.querySelector('[data-qa=applicant-profile-job-search-status-value]').textContent='Активно ищу работу';dialog.hidden=true}
          document.addEventListener('keydown',event=>{if(event.key==='Escape')dialog.hidden=true});
        </script>` })
    })
    await assert.rejects(verifyActiveJobSearchStatus(page), { code: 'profile_hh_job_search_status_incomplete' })
    assert.equal(writes, 0, 'Final verification must not change the status')
    assert.equal(await ensureActiveJobSearchStatus(page), 'active_search')
    assert.equal(writes, 1)
    assert.equal(await ensureActiveJobSearchStatus(page), 'active_search')
    assert.equal(writes, 1, 'After another publication, verify a matching status without toggling it')
    status = 'looking_for_offers'; discardSave = true
    await assert.rejects(ensureActiveJobSearchStatus(page), { code: 'profile_hh_job_search_status_incomplete' })
  } finally { await browser.close() }
}
