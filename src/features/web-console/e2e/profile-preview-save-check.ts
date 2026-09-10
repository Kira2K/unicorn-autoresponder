import assert from 'node:assert/strict'
import type { Page } from 'playwright'

export async function checkPreviewSaveUi(page: Page, job: object, reopen: () => Promise<void>) {
  const original = structuredClone(job)
  const retry = '**/api/admin/linkedin/profile-jobs/preparation-ui/resume'
  const generation = '**/api/admin/linkedin/accounts/203/profile-generations'
  let saves = 0, generations = 0
  const rejectGeneration = (route: import('playwright').Route) => {
    generations++; return route.fulfill({ status: 500, json: { error: 'unexpected_generation' } })
  }
  await page.route(generation, rejectGeneration)
  await page.route(retry, route => {
    saves++
    Object.assign(job, original, { previewRecovery: undefined, retry: undefined, errorCode: undefined })
    return route.fulfill({ json: job })
  })
  try {
    Object.assign(job, { status: 'failed', phase: 'preview_failed', errorCode: 'noco_rate_limited', previewRecovery: 'rebuild' })
    await reopen()
    await page.getByTestId('profile-result-title').getByText('Не удалось подготовить Preview', { exact: true }).waitFor()
    await page.getByText('Сбой произошёл до заполнения LinkedIn. Изменения в профиль не отправлялись.').waitFor()
    assert.equal(await page.getByText('Не все изменения подтверждены.', { exact: false }).count(), 0)
    await page.getByRole('button', { name: 'Восстановить Preview без генерации', exact: true }).click()
    await page.getByTestId('profile-filler-apply').waitFor()
    assert.equal(saves, 1); assert.equal(generations, 0)
    Object.assign(job, { status: 'waiting_retry', phase: 'waiting_preview_save', previewRecovery: 'save',
      retry: { provider: 'noco', nextRetryAt: new Date(Date.now() + 120_000).toISOString() } })
    await reopen()
    const save = page.getByRole('button', { name: 'Повторить сохранение Preview', exact: true })
    assert(await save.isDisabled(), 'Retry-After is visible and disables the retry button')
    await page.getByRole('button', { name: 'Закрыть и остановить', exact: true }).waitFor()
    Object.assign(job, { retry: { provider: 'noco', nextRetryAt: '2020-01-01' } })
    await reopen()
    await save.click()
    await page.getByTestId('profile-filler-apply').waitFor()
    assert.equal(saves, 2); assert.equal(generations, 0)
    await page.getByRole('button', { name: 'Подготовить заново', exact: true }).waitFor()
  } finally {
    await page.unroute(retry)
    await page.unroute(generation, rejectGeneration)
    for (const key of Object.keys(job)) Reflect.deleteProperty(job, key)
    Object.assign(job, original)
    await reopen()
  }
}
