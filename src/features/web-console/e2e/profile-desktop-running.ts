import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { desktopProfileJob } from './profile-desktop-fixture.ts'

export async function checkProfileRunning(page: Page, job: ReturnType<typeof desktopProfileJob>, readCount: () => number) {
  await page.getByTestId('profile-filler-apply').click()
  await page.getByTestId('profile-confirm-submit').click()
  await page.getByTestId('profile-progress').waitFor()
  await page.getByTestId('profile-filler-close').click()
  await page.locator('.profile-filler-dialog').waitFor({ state: 'hidden' })
  await page.getByTestId('profile-filler-203').getByText('Открыть прогресс').waitFor()
  await page.getByTestId('profile-filler-203').click()
  await page.getByTestId('profile-filler-history').locator('summary').click()
  await page.locator('.profile-history-button').filter({ hasText: 'Профиль заполнен и проверен' }).click()
  await page.getByText('Вы просматриваете историю.', { exact: false }).waitFor()
  const before = readCount()
  await page.waitForTimeout(2200)
  assert(readCount() - before >= 2 && readCount() - before <= 3, 'one active observer survives history')
  await page.getByRole('button', { name: 'Вернуться к прогрессу', exact: true }).click()
  await page.getByTestId('profile-progress').waitFor()
  await page.reload()
  await page.getByTestId('admin-dashboard').waitFor()
  await page.getByTestId('admin-linkedin-tab').click()
  await page.getByTestId('profile-filler-203').click()
  await page.getByTestId('profile-progress').waitFor()
  assert.equal(await page.getByTestId('profile-filler-apply').count(), 0)
  job.status = 'needs_expert_review'
  job.phase = 'partially_completed'
  job.preview.issues = [{ level: 'warning', path: 'profile.skills.omitted',
    message: 'Skills not applied.', suggestions: ['New specialty'] }]
  job.result!.status = 'verified'
  job.result!.steps.forEach(step => { step.status = 'verified' })
  await page.getByTestId('profile-partially-completed').waitFor({ timeout: 5000 })
  assert.match(await page.getByTestId('profile-result').innerText(), /New specialty/)
  assert.equal(await page.getByTestId('profile-result-title').count(), 0)
  job.phase = 'verification_unavailable'
  job.result!.steps[0].status = 'failed'
  await page.reload()
  await page.getByTestId('admin-dashboard').waitFor()
  await page.getByTestId('admin-linkedin-tab').click()
  await page.getByTestId('profile-filler-203').click()
  await page.getByTestId('profile-filler-history').locator('summary').click()
  await page.locator('.profile-history-button').filter({ hasText: 'Нужна проверка' }).click()
  await page.getByTestId('profile-result-title').getByText('Нужна проверка').waitFor()
  assert.equal(await page.getByTestId('profile-filler-apply').count(), 0)
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'logs/profile-filler-ui/needs-review.png' })
}
