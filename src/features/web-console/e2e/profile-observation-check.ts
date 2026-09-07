import assert from 'node:assert/strict'
import type { Page } from 'playwright'

export async function checkProfileObservation(page: Page) {
  let status = 'verifying'
  let phase = 'final_verification:1/4'
  let detailReads = 0
  const prefix = '**/api/admin/linkedin/profile-jobs'
  const job = () => ({ jobId: 'observation-fixture', platformAccountId: 203, clientName: 'Connected Client',
    status, phase, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    preview: { issues: phase === 'partially_completed' ? [{ level: 'warning', path: 'profile.skills.omitted',
      message: 'Unapplied skill: New specialty.' }] : [], steps: [], document: { profile: {} } },
    result: { status: status === 'verifying' ? 'verifying' : 'verified', steps: [{ stepId: 'headline',
      section: 'headline', status: status === 'verifying' ? 'verifying' : 'verified',
      message: 'Read-only fixture', attempt: 1, maxAttempts: 4,
      nextActionAt: new Date(Date.now() + 60000).toISOString() }] } })
  await page.route(prefix, route => route.fulfill({ json: { jobs: [job()] } }))
  await page.route(`${prefix}/observation-fixture`, route => {
    detailReads += 1
    return detailReads === 1 ? route.fulfill({ status: 503, json: { error: 'temporary read failure' } })
      : route.fulfill({ json: job() })
  })
  await page.reload()
  await page.getByTestId('admin-dashboard').waitFor()
  await page.getByTestId('admin-linkedin-tab').click()
  await page.getByTestId('profile-filler-203').click()
  await page.getByTestId('profile-progress').getByText('Проверяем в LinkedIn', { exact: false }).first().waitFor()
  await page.locator('.profile-step-timer').waitFor()
  await page.waitForTimeout(100)
  status = 'succeeded'; phase = 'completed_verified'
  await page.getByTestId('profile-result-title').getByText('Профиль заполнен и проверен', { exact: true }).waitFor({ timeout: 10000 })
  assert(detailReads >= 2)
  status = 'needs_expert_review'; phase = 'partially_completed'
  await page.reload()
  await page.getByTestId('admin-dashboard').waitFor()
  await page.getByTestId('admin-linkedin-tab').click()
  await page.getByTestId('profile-filler-203').click()
  await page.getByTestId('profile-filler-history').locator('summary').click()
  await page.locator('.profile-history-button').first().click()
  await page.getByTestId('profile-partially-completed').waitFor()
  assert.equal(await page.getByTestId('profile-result-title').count(), 0)
  await page.unroute(`${prefix}/observation-fixture`)
  await page.unroute(prefix)
}
