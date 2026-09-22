import { openLinkedInManual } from './linkedin-navigation.ts'
import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { fixture } from '../../linkedin-automation/invitation-withdrawal/test-fixture.ts'

export function rateLimitFixture() {
  const f = fixture(), list = f.provider.list
  let now = f.runtime.now(), limited = false, released = false, release!: () => void
  const hold = new Promise<void>(resolve => { release = () => { released = true; resolve() } })
  f.runtime.assertRead = id => { if (id !== 203) throw new Error('Wrong account') }
  f.runtime.now = () => now
  f.runtime.sleep = async ms => { if (limited && !released) await hold; now += ms }
  f.provider.list = async () => {
    if (f.calls.length && !limited) {
      limited = true
      throw { code: 'unipile_api_too_many_requests', details: { httpStatus: 429 } }
    }
    return list()
  }
  return { ...f, release }
}
export async function checkWithdrawalRateLimit(page: Page, f: ReturnType<typeof rateLimitFixture>, stop = false) {
  try {
    await page.reload(); await page.getByTestId('admin-linkedin-tab').click()
    await openLinkedInManual(page, 203, 'invitations')
    await page.getByTestId('withdrawal-open-203').click(); await page.getByTestId('withdrawal-load').click()
    await page.getByText('Всего ожидают: 2. Подходят для отзыва: 2.').waitFor()
    page.once('dialog', dialog => void dialog.accept()); await page.getByTestId('withdrawal-start').click()
    await page.getByTestId('withdrawal-retry').waitFor()
    assert.deepEqual(f.calls, ['1'])
    assert.ok(f.stored()?.run?.nextActionAt)
    await page.getByTestId('withdrawal-minimize').click()
    await page.getByTestId('withdrawal-summary-203').filter({ hasText: 'Пауза: Unipile' }).waitFor()
    await page.reload(); await page.getByTestId('admin-linkedin-tab').click()
    await openLinkedInManual(page, 203, 'invitations')
    await page.getByTestId('withdrawal-summary-203').filter({ hasText: 'Пауза: Unipile' }).waitFor()
    await page.getByTestId('withdrawal-open-203').click()
    await page.getByTestId('withdrawal-retry').waitFor()
    if (stop) {
      const response = page.waitForResponse(r => r.url().endsWith('/invitation-withdrawal/stop') && r.request().method() === 'POST')
      await page.getByTestId('withdrawal-stop').click(); assert.equal((await response).status(), 200)
      assert.equal((await f.service.status(203))?.stopRequested, true)
    }
    f.release()
    if (stop) {
      await page.getByTestId('withdrawal-recheck').waitFor()
      assert.deepEqual(f.calls, ['1'])
    } else {
      await page.getByTestId('withdrawal-progress').getByText('Очередь завершена', { exact: true }).waitFor()
      assert.deepEqual(f.calls, ['1', '2'])
      assert.equal(await page.getByTestId('withdrawal-retry').count(), 0)
    }
  } finally { f.release(); await f.service.close() }
}
