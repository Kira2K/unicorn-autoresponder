import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { checkProfileDates } from './profile-dates-check.ts'

export async function checkProfileInline(page: Page, job: {
  planHash: string; preview: { disabledFields?: string[]; document: { profile: { headline: string } } }
}, reopen: () => Promise<void>) {
  let edits = 0
  const endpoint = '**/api/admin/linkedin/profile-jobs/preparation-ui/fields'
  await page.route(endpoint, route => {
    edits++
    const body = route.request().postDataJSON()
    assert.equal(body.path, 'profile.headline')
    assert.equal(body.planHash, job.planHash)
    if (typeof body.enabled === 'boolean') {
      job.preview.disabledFields = body.enabled ? [] : [body.path]
      job.planHash = `selected-${edits}`
      return route.fulfill({ json: job })
    }
    if (!body.value) return route.fulfill({ status: 422, json: { error: 'profile_field_invalid',
      issues: [{ path: body.path, message: 'Заполните это поле.', level: 'fatal' }] } })
    job.preview.document.profile.headline = body.value
    job.planHash = 'inline-checked-plan'
    return route.fulfill({ json: job })
  })
  try {
    const education = page.locator('[data-section="education"]')
    const originalText = await education.innerText()
    assert.equal(await education.getByRole('button', { name: /^Изменить:/ }).count(), 9)
    await education.locator(':scope > summary').click()
    assert.equal(await education.getAttribute('open'), null)
    assert.equal(await education.locator(':scope > summary [data-status]').getAttribute('data-status'), 'blocker')
    await education.locator(':scope > summary').click()
    assert.equal(await education.innerText(), originalText, 'collapse never changes fields or warnings')
    const field = page.locator('[data-field-path="profile.headline"]')
    await field.getByRole('button', { name: 'Изменить: Заголовок' }).click()
    const input = field.getByRole('textbox')
    await input.fill('')
    assert.equal(edits, 0)
    await input.press('Tab')
    await field.getByText('Заполните это поле.', { exact: true }).waitFor()
    assert(await page.getByTestId('profile-filler-apply').isDisabled())
    await input.fill('Platform Engineer')
    await input.press('Tab')
    await field.getByText('Platform Engineer', { exact: true }).waitFor()
    assert.equal(edits, 2)
    assert.equal(await page.getByRole('button', { name: 'Пересобрать Preview', exact: true }).count(), 0)
    assert.equal(await education.innerText(), originalText, 'editing one field keeps all other information')
    await page.getByTestId('profile-filler-minimize').click()
    await page.getByTestId('profile-filler-203').click()
    await field.getByText('Platform Engineer', { exact: true }).waitFor()
    await reopen()
    await field.getByText('Platform Engineer', { exact: true }).waitFor()
    assert.equal(edits, 2, 'reopen/reload does not resubmit edits')
    const checkbox = page.getByRole('checkbox', { name: 'Заполнять раздел: Заголовок', exact: true })
    assert(await checkbox.isChecked(), 'all fields enabled by default')
    await checkbox.uncheck()
    await field.getByText('Не заполнять', { exact: true }).waitFor()
    await reopen()
    assert.equal(await checkbox.isChecked(), false, 'reload restores selection')
    await field.getByText('Platform Engineer', { exact: true }).waitFor()
    await checkbox.check()
    await field.getByText('Готово', { exact: true }).waitFor()
    assert.equal(edits, 4)
    await education.locator(':scope > summary').click()
    await page.screenshot({ path: 'logs/profile-filler-ui/inline-collapsed.png', animations: 'disabled' })
    await education.locator(':scope > summary').click()
  } finally { await page.unroute(endpoint) }
  await checkProfileDates(page, job, reopen)
}
