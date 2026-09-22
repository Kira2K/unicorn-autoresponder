import { openLinkedInManual } from './linkedin-navigation.ts'
import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import type { concurrencyFixture } from '../../linkedin-automation/invitation-withdrawal/concurrency-fixture.ts'
export async function checkWithdrawalMinimize(page: Page, f: ReturnType<typeof concurrencyFixture>) {
  const writes: string[] = []
  const capture = (request: import('playwright').Request) => {
    if (request.method() === 'POST' && request.url().includes('/invitation-withdrawal')) writes.push(new URL(request.url()).pathname)
  }
  page.on('request', capture)
  try {
    await page.reload(); await page.getByTestId('admin-linkedin-tab').click()
    for (const id of [203, 103]) {
      await openLinkedInManual(page, id, 'invitations')
      await page.getByTestId(`withdrawal-open-${id}`).click()
      await page.getByTestId('withdrawal-load').click()
      await page.getByText('Всего ожидают: 2. Подходят для отзыва: 2.').waitFor()
      page.once('dialog', dialog => void dialog.accept())
      await page.getByTestId('withdrawal-start').click(); await f.entered(id)
      await page.getByTestId('withdrawal-minimize').click()
      await page.getByTestId('withdrawal-dialog').waitFor({ state: 'hidden' })
      assert.match(await page.getByTestId(`withdrawal-summary-${id}`).innerText(), /Отзыв выполняется.*0 из 2/s)
    }
    assert.equal(writes.length, 2) // Minimize sends neither Stop nor another Start.
    assert.equal((await f.service.status(203))?.status, 'running')
    assert.equal((await f.service.status(103))?.status, 'running')
    f.release(203)
    await openLinkedInManual(page, 203, 'invitations')
    await page.getByTestId('withdrawal-summary-203').filter({ hasText: 'Очередь завершена' }).waitFor()
    assert.match(await page.getByTestId('withdrawal-summary-203').innerText(), /2 из 2/)
    assert.match(await page.getByTestId('withdrawal-summary-103').innerText(), /Отзыв выполняется.*0 из 2/s)
    await openLinkedInManual(page, 203, 'invitations')
    await page.getByTestId('withdrawal-open-203').click()
    assert.match(await page.getByTestId('withdrawal-progress').innerText(), /Подтверждено отзывов: 2 из 2/)
    await page.getByTestId('withdrawal-minimize').click()
    await openLinkedInManual(page, 103, 'invitations')
    await page.getByTestId('withdrawal-open-103').click()
    assert.match(await page.getByTestId('withdrawal-progress').innerText(), /Подтверждено отзывов: 0 из 2/)
    const stopping = page.waitForResponse(response => response.request().method() === 'POST' &&
      response.url().endsWith('/accounts/103/invitation-withdrawal/stop'))
    await page.getByTestId('withdrawal-stop').click(); assert.equal((await stopping).status(), 200)
    assert.equal((await f.service.status(103))?.stopRequested, true); f.release(103)
    await page.getByTestId('withdrawal-progress').getByText('Остановлено', { exact: true }).waitFor()
    await page.reload(); await page.getByTestId('admin-linkedin-tab').click()
    await openLinkedInManual(page, 203, 'invitations')
    await page.getByTestId('withdrawal-summary-203').filter({ hasText: 'Очередь завершена' }).waitFor()
    await openLinkedInManual(page, 103, 'invitations')
    await page.getByTestId('withdrawal-summary-103').filter({ hasText: 'Остановлено' }).waitFor()
    const search = page.getByTestId('linkedin-search')
    await search.fill('Test Client'); await page.getByTestId('withdrawal-open-203').waitFor({ state: 'hidden' })
    await search.fill(''); await openLinkedInManual(page, 203, 'invitations')
    await page.getByTestId('withdrawal-summary-203').filter({ hasText: 'Очередь завершена' }).waitFor()
    assert.deepEqual(writes, ['/api/admin/linkedin/accounts/203/invitation-withdrawal',
      '/api/admin/linkedin/accounts/103/invitation-withdrawal', '/api/admin/linkedin/accounts/103/invitation-withdrawal/stop'])
    assert.equal(f.calls.length, 3)
    assert.equal(new Set(f.calls.map(row => `${row.accountId}:${row.invitationId}`)).size, 3)
    await page.screenshot({ path: '.codex-tmp/withdrawal-minimized.png', fullPage: true })
  } finally { page.off('request', capture); await f.close() }
}
