import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { fixture } from '../../linkedin-automation/invitation-withdrawal/test-fixture.ts'
export function recheckFixture() {
  const f = fixture(), cancel = f.provider.cancel
  f.runtime.assertRead = id => { if (id !== 203) throw new Error('Wrong account') }
  f.provider.cancel = async (account, id) => { await cancel(account, id); throw new Error('Response lost') }
  return f
}
export async function checkWithdrawalRecheck(page: Page, f: ReturnType<typeof recheckFixture>) {
  try {
    await page.reload(); await page.getByTestId('admin-linkedin-tab').click()
    await page.getByTestId('withdrawal-open-203').click(); await page.getByTestId('withdrawal-load').click()
    await page.getByText('Всего ожидают: 2. Подходят для отзыва: 2.').waitFor()
    page.once('dialog', dialog => void dialog.accept()); await page.getByTestId('withdrawal-start').click()
    await page.getByTestId('withdrawal-recheck').waitFor()
    assert.equal(f.calls.length, 1)
    await page.getByTestId('withdrawal-load').click()
    await page.getByText('Всего ожидают: 1. Подходят для отзыва: 1.').waitFor()
    assert.equal(await page.getByTestId('withdrawal-start').isDisabled(), true)
    const save = f.runtime.store.save
    f.runtime.store.save = async () => { throw new Error('Save unavailable') }
    await page.getByTestId('withdrawal-recheck').click()
    await page.getByText('Не удалось проверить приглашения. Проверьте подключение и повторите позже.').waitFor()
    assert.match(await page.getByTestId('withdrawal-progress').innerText(), /Подтверждено отзывов: 0 из 2/)
    f.runtime.store.save = save
    await page.getByTestId('withdrawal-recheck').click()
    await page.getByTestId('withdrawal-progress').getByText('Остановлено', { exact: true }).waitFor()
    assert.match(await page.getByTestId('withdrawal-progress').innerText(), /Подтверждено отзывов: 1 из 2/)
    assert.equal(await page.getByTestId('withdrawal-recheck').count(), 0)
    await page.reload(); await page.getByTestId('admin-linkedin-tab').click()
    await page.getByTestId('withdrawal-summary-203').filter({ hasText: 'Отозвано: 1 из 2.' }).waitFor()
    assert.deepEqual(f.calls, ['1'])
    await page.getByTestId('withdrawal-open-203').click()
    await page.screenshot({ path: '.codex-tmp/withdrawal-rechecked.png', fullPage: true })
  } finally { await f.service.close() }
}
