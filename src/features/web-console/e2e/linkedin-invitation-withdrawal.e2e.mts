import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { concurrencyFixture } from '../../linkedin-automation/invitation-withdrawal/concurrency-fixture.ts'
import { checkWithdrawalMinimize } from './withdrawal-minimize-check.mts'
import { checkWithdrawalRecheck, recheckFixture } from './withdrawal-recheck-check.mts'
import { checkWithdrawalRateLimit, rateLimitFixture } from './withdrawal-rate-limit-check.mts'
const require = createRequire(import.meta.url)
const { createWebConsoleApp } = require('../backend/app.ts')
const { createMockConnectionInviterService } = require('../backend/connection-inviter-mock.ts')
const originalFetch = globalThis.fetch
globalThis.fetch = (input, options) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('External network forbidden in mock E2E')
  return originalFetch(input, options)
}
const inviter = createMockConnectionInviterService()
const backend = createWebConsoleApp({ useMockData: true, connectionInviter: inviter }).listen(0, '127.0.0.1')
await new Promise(resolve => backend.once('listening', resolve))
const previousApi = process.env.WEB_CONSOLE_API_URL
process.env.WEB_CONSOLE_API_URL = `http://127.0.0.1:${backend.address().port}`
const frontend = await createServer({ configFile: resolve('src/features/web-console/frontend/vite.config.js'),
  server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' })
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  await mkdir('.codex-tmp', { recursive: true })
  await frontend.listen()
  const address = frontend.httpServer!.address() as import('node:net').AddressInfo
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort())
  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.getByTestId('email-input').fill('unicornveryevil@gmail.com')
  await page.locator('input[type="password"]').fill('101010')
  await page.getByTestId('login-button').click()
  await page.getByTestId('admin-linkedin-tab').click()
  await page.getByTestId('withdrawal-open-203').click()
  await page.getByTestId('withdrawal-load').click()
  await page.getByText('Всего ожидают: 4. Подходят для отзыва: 2.').waitFor()
  assert.match(await page.getByTestId('withdrawal-list').innerText(), /30 дн\./)
  assert.match(await page.getByTestId('withdrawal-list').innerText(), /18 дн\./)
  assert.match(await page.getByTestId('withdrawal-start').innerText(), /старше 14 дней/)
  assert.match(await page.getByTestId('withdrawal-list').innerText(), /Нет надёжной даты/)
  await page.screenshot({ path: '.codex-tmp/withdrawal-preview.png', fullPage: true })
  page.once('dialog', dialog => void dialog.dismiss())
  await page.getByTestId('withdrawal-start').click()
  assert.equal(await page.getByTestId('withdrawal-progress').count(), 0)
  page.once('dialog', dialog => void dialog.accept())
  await page.getByTestId('withdrawal-start').click()
  await page.getByTestId('withdrawal-stop').click()
  await page.getByText('Остановлено', { exact: true }).waitFor()
  await page.reload(); await page.getByTestId('admin-linkedin-tab').click()
  await page.getByTestId('withdrawal-open-203').click()
  await page.getByText('Остановлено', { exact: true }).waitFor()
  await page.getByTestId('withdrawal-load').click()
  page.once('dialog', dialog => void dialog.accept())
  await page.getByTestId('withdrawal-start').click()
  await page.getByText('Очередь завершена', { exact: true }).waitFor()
  await page.getByTestId('withdrawal-load').click()
  await page.getByText('Всего ожидают: 2. Подходят для отзыва: 0.').waitFor()
  assert.equal(await page.getByTestId('withdrawal-start').isDisabled(), true)
  const concurrent = concurrencyFixture(); inviter.withdrawals = concurrent.service
  await checkWithdrawalMinimize(page, concurrent)
  const recheck = recheckFixture(); inviter.withdrawals = recheck.service
  await checkWithdrawalRecheck(page, recheck)
  for (const stop of [false, true]) {
    const limited = rateLimitFixture(); inviter.withdrawals = limited.service
    await checkWithdrawalRateLimit(page, limited, stop)
  }
  console.log('withdrawal mock browser E2E: preview, confirmation, Stop, minimize, two accounts, recheck, 429 resume/Stop and reload passed')
} finally {
  await browser?.close(); await frontend.close()
  await new Promise<void>(resolve => backend.close(() => resolve()))
  globalThis.fetch = originalFetch
  if (previousApi === undefined) delete process.env.WEB_CONSOLE_API_URL
  else process.env.WEB_CONSOLE_API_URL = previousApi
}
