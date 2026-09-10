import assert from 'node:assert/strict'
import type { Page } from 'playwright'
export async function checkProfileDates(page: Page, job: {
  planHash: string; preview: { disabledFields?: string[]; document: { profile: object } }
}, reopen: () => Promise<void>) {
  const before = structuredClone(job), endpoint = '**/api/admin/linkedin/profile-jobs/preparation-ui/fields'
  let writes = 0, reject = true
  await page.route(endpoint, route => {
    const body = route.request().postDataJSON()
    assert.equal(body.planHash, job.planHash); writes++
    if (typeof body.enabled === 'boolean') {
      assert.equal(body.path, 'profile.education')
      job.preview.disabledFields = body.enabled ? [] : [body.path]
    } else {
      assert.equal(body.path, 'profile.education[0].data.end_date')
      assert.equal(body.value, '2021-09')
      if (reject) return route.fulfill({ status: 409, json: { error: 'linkedin_provider_id_mismatch' } })
      Object.assign(job.preview.document.profile, { education: [{ data: { school: 'University', end_date: body.value } }] })
    }
    job.planHash = `date-${writes}`
    return route.fulfill({ json: job })
  })
  try {
    const section = page.locator('[data-section="education"]')
    const checkbox = section.getByRole('checkbox', { name: 'Заполнять раздел: Образование', exact: true })
    assert.equal(await section.locator('[data-field-path] input[type="checkbox"]').count(), 0)
    assert(await checkbox.isChecked())
    const field = section.locator('[data-field-path="profile.education[0].data.end_date"]')
    await field.getByRole('button', { name: 'Изменить: Окончание', exact: true }).click()
    const month = field.getByRole('combobox', { name: 'Окончание: месяц' })
    const year = field.getByRole('spinbutton', { name: 'Окончание: год' })
    assert.equal(await year.inputValue(), '2021'); assert.equal(await month.inputValue(), '')
    const save = field.getByRole('button', { name: 'Сохранить дату' })
    assert(await save.isDisabled())
    await year.fill('')
    let typedYear = ''
    for (const digit of '2021') {
      await year.press(digit); typedYear += digit
      assert.equal(await year.inputValue(), typedYear, 'year remains visible after every keystroke')
    }
    await month.selectOption('09'); await year.focus(); await year.press('Tab')
    assert.equal(writes, 0, 'moving between date parts never sends incomplete values')
    await field.screenshot({ path: 'logs/profile-filler-ui/date-editor.png', animations: 'disabled' })
    await save.click()
    await field.getByText(/Не удалось подтвердить владельца/).waitFor()
    assert(await page.getByTestId('profile-filler-apply').isDisabled())
    await checkbox.uncheck()
    await field.getByText('Правка осталась в редакторе. Отключённый раздел не будет заполнен.').waitFor()
    assert(!(await page.getByTestId('profile-filler-apply').isDisabled()))
    await checkbox.check()
    await month.waitFor()
    assert.equal(await month.inputValue(), '09', 'draft survives exclusion')
    assert(await page.getByTestId('profile-filler-apply').isDisabled())
    await field.getByRole('button', { name: 'Отменить правку' }).click()
    await checkbox.uncheck()
    await reopen()
    assert(!await checkbox.isChecked(), 'cancel + uncheck remains saved after reload')
    await checkbox.check()
    await field.getByRole('button', { name: 'Изменить: Окончание', exact: true }).click()
    await month.selectOption('09'); reject = false
    await save.click()
    await field.getByText('2021-09', { exact: true }).waitFor()
    assert.equal(writes, 6, 'two explicit date saves and four section changes')
    await reopen()
    await field.getByText('2021-09', { exact: true }).waitFor()
    await page.screenshot({ path: 'logs/profile-filler-ui/sections-dates.png', animations: 'disabled' })
  } finally {
    await page.unroute(endpoint)
    Object.assign(job, before)
    await reopen()
  }
}
