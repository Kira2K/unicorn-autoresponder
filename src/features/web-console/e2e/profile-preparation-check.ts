import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { profileJobsRoute } from './profile-desktop-fixture.ts'
import { checkProfileInline } from './profile-inline-check.ts'
import { checkPreviewSaveUi } from './profile-preview-save-check.ts'

export async function checkProfilePreparation(page: Page) {
  const prefix = '**/api/admin/linkedin/profile-jobs/preparation-ui'
  const generate = '**/api/admin/linkedin/accounts/203/profile-generations'
  const job = { jobId: 'preparation-ui', platformAccountId: 203, clientName: 'Connected Client',
    status: 'generating_profile', phase: 'generating_profile', planHash: 'partial-plan',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    preview: { canApply: true, skippedChanges: ['profile.education[0]'],
      document: { profile: { headline: 'Engineer', education: [{ data: { school: 'University', end_date: '2021' } }] } },
      issues: [{ level: 'fatal', path: 'profile.education[0].data.end_date',
        message: 'Unipile requires a month to write end_date; the CV does not supply it.' }],
      steps: [{ id: 'headline', section: 'headline', action: 'update', before: 'Old', after: 'Engineer' }] } }
  let started = false, stops = 0, applies = 0
  let result: object | undefined
  const snapshot = () => ({ ...job, preview: job.status === 'generating_profile' ? undefined : job.preview, result })
  await page.route(profileJobsRoute, route => route.fulfill({ json: { jobs: started ? [snapshot()] : [] } }))
  await page.route(generate, route => { started = true; return route.fulfill({ json: snapshot() }) })
  await page.route(prefix, route => route.fulfill({ json: snapshot() }))
  await page.route(`${prefix}/stop-generation`, route => {
    stops += 1; job.status = 'failed'; job.phase = 'generation_stopped'
    return route.fulfill({ json: snapshot() })
  })
  await page.route(`${prefix}/apply`, route => {
    assert.equal(route.request().postDataJSON().planHash, job.planHash)
    applies += 1; job.status = 'needs_expert_review'; job.phase = 'partially_completed'
    result = { status: 'verified', steps: [{ stepId: 'headline', section: 'headline', status: 'verified', message: 'Verified' }] }
    return route.fulfill({ json: snapshot() })
  })
  async function open() {
    await page.reload()
    await page.getByTestId('admin-dashboard').waitFor()
    await page.getByTestId('admin-linkedin-tab').click()
    await page.getByTestId('profile-filler-203').click()
    if (started && ['failed', 'needs_expert_review', 'preview_ready', 'waiting_retry'].includes(job.status)) {
      await page.getByTestId('profile-filler-history').locator('summary').click()
      await page.locator('.profile-history-button').click()
    }
  }
  try {
    await open()
    await page.getByTestId('profile-filler-generate').click()
    const stop = page.getByTestId('profile-generation-stop')
    await stop.waitFor()
    await stop.click()
    await page.locator('.profile-filler-dialog').waitFor({ state: 'hidden' })
    assert.equal(stops, 1)
    assert.equal(applies, 0)
    await open()
    await page.getByTestId('profile-result-title').getByText('Подготовка остановлена', { exact: true }).waitFor()
    assert.equal(await stop.count(), 0)
    await page.getByTestId('profile-generation-restart').click()
    job.status = 'preview_ready'; job.phase = 'preview_ready'
    await page.getByTestId('profile-filler-generate').click()
    const fields = page.locator('.profile-inline-field')
    await fields.first().waitFor()
    assert.match(await fields.allTextContents().then(values => values.join(' ')), /месяц окончания/)
    assert(await page.locator('.profile-inline-field[data-status="blocker"]').count())
    await checkProfileInline(page, job, open)
    await checkPreviewSaveUi(page, job, open)
    await page.getByTestId('profile-filler-apply').click()
    await page.getByTestId('profile-partial-confirmation').getByText('Профиль будет заполнен частично.', { exact: true }).waitFor()
    assert.equal(applies, 0, 'warning precedes Apply')
    await page.waitForTimeout(300)
    const warning = page.getByTestId('profile-partial-confirmation')
    assert.match(await warning.innerText(), /Образование/)
    assert((await warning.boundingBox())!.height > 80, 'skip warning must be readable, not a collapsed banner')
    await page.screenshot({ path: 'logs/profile-filler-ui/partial-confirmation.png', animations: 'disabled' })
    await page.getByTestId('profile-confirm-submit').click()
    await page.getByTestId('profile-partially-completed').getByText('Заполнен частично', { exact: true }).waitFor()
    assert.equal(applies, 1)
    await open()
    await page.getByTestId('profile-partially-completed').getByText('Заполнен частично', { exact: true }).waitFor()
    assert.equal(applies, 1, 'reload never repeats Apply')
  } finally {
    await page.unroute(profileJobsRoute)
    await page.unroute(generate)
    for (const suffix of ['', '/stop-generation', '/apply']) await page.unroute(`${prefix}${suffix}`)
  }
}
