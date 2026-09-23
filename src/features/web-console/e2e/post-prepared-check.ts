import assert from 'node:assert/strict'
import type { Page } from 'playwright'

export async function checkPreparedPosts(page: Page, base: string) {
  const api = `${base}/api/admin/linkedin/accounts/203/post-writer`
  await page.getByTestId('post-scheduled').uncheck()
  await page.getByTestId('post-content-mode').selectOption('prepared')
  assert.equal(await page.getByTestId('post-start').count(), 0)
  assert.equal(await page.getByTestId('post-prepared-plan').locator('textarea').count(), 7)
  const next = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10)
  await page.getByTestId('post-prepared-week').fill(next)
  await page.getByTestId('post-prepared-week').press('Tab')
  const first = '  Готовый пост из буфера 🦄\n\nАбзац и пробелы должны сохраниться.  '
  const second = 'Второй пост. Другой день, свой текст и отдельный мем.'
  await page.getByTestId('post-prepared-1').fill(first)
  await page.getByTestId('post-prepared-3').fill(second)
  const saved = page.waitForResponse(response => response.url() === `${api}/settings` && response.request().method() === 'PUT')
  await page.getByTestId('post-save').click()
  assert.equal((await saved).status(), 200)
  let data = await (await page.request.get(api)).json()
  assert.equal(data.settings.contentMode, 'prepared')
  assert.deepEqual(data.settings.preparedPosts.map((item: { text: string }) => item.text), [first, second])
  const runCount = data.runs.length
  await page.reload()
  await page.getByTestId('admin-linkedin-tab').click()
  await page.getByTestId('post-writer-203').click()
  await page.getByTestId('post-prepared-1').waitFor()
  assert.equal(await page.getByTestId('post-prepared-1').inputValue(), first)
  assert.equal(await page.getByTestId('post-prepared-2').inputValue(), '')
  assert.equal(await page.getByTestId('post-prepared-3').inputValue(), second)
  const denied = await page.request.post(`${api}/runs`, { data: { mode: 'automatic', requestKey: 'prepared-not-manual' } })
  assert.equal(denied.status(), 409)
  data = await (await page.request.get(api)).json()
  assert.equal(data.runs.length, runCount)
  await page.screenshot({ path: 'logs/post-writer-checks/prepared-week.png', fullPage: true })
  console.log('Prepared-post UI passed: seven days, exact saved text, blank day, reload, no immediate publication.')
}
