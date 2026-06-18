const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '../../../..')
const ARTIFACT_DIR = path.join(ROOT, 'tmp', 'web-console-e2e')
const API_PORT = 4310
const UI_PORT = 4311

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function spawnProcess(command: string, args: string[], env: Record<string, string>) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (data: Buffer) => process.stdout.write(String(data)))
  child.stderr.on('data', (data: Buffer) => process.stderr.write(String(data)))
  return child
}

async function waitForHttp(url: string, timeoutMs = 30000): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch (error) {
      lastError = error
    }
    await wait(250)
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${url}`)
}

async function stopProcess(child: ReturnType<typeof spawnProcess>): Promise<void> {
  if (child.killed || child.exitCode !== null) return
  child.kill()
  await wait(500)
}

async function runTests(): Promise<void> {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const backend = spawnProcess(process.execPath, ['src/features/web-console/backend/index.ts'], {
    WEB_CONSOLE_USE_MOCK_DATA: 'true',
    WEB_CONSOLE_DOLPHIN_LEASE_DRY_RUN: 'true',
    DOLPHIN_SHARED_USER_LEASE_MS: '15000',
    WEB_CONSOLE_HOST: '127.0.0.1',
    WEB_CONSOLE_PORT: String(API_PORT)
  })
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  const frontend = spawnProcess(process.execPath, [
    viteBin,
    '--config',
    'src/features/web-console/frontend/vite.config.js',
    '--host',
    '127.0.0.1',
    '--port',
    String(UI_PORT)
  ], {
    WEB_CONSOLE_API_URL: `http://127.0.0.1:${API_PORT}`,
    WEB_CONSOLE_FRONTEND_PORT: String(UI_PORT)
  })

  let browser: any
  try {
    await waitForHttp(`http://127.0.0.1:${API_PORT}/api/auth/me`)
    await waitForHttp(`http://127.0.0.1:${UI_PORT}`)

    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })

    await page.goto(`http://127.0.0.1:${UI_PORT}`)
    await page.getByTestId('login-page').waitFor()
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-login.png'), fullPage: true })

    await page.getByTestId('email-input').fill('client@example.com')
    await page.locator('input[type="password"]').fill('1234')
    await page.getByTestId('login-button').click()
    await page.getByTestId('client-dashboard').waitFor()
    await assertText(page, 'Kira Test')
    await assertText(page, 'hh_ru')
    await page.getByTestId('open-dolphin-client-button').click()
    await page.getByTestId('dolphin-lease-panel').waitFor()
    await page.getByTestId('dolphin-lease-panel').getByText('Kira Test', { exact: false }).waitFor()
    await assertText(page, 'Dolphin access')
    await assertText(page, 'kind.cute.unicorn@gmail.com')
    await assertText(page, 'Client email')
    await assertText(page, 'client@example.com')
    await assertText(page, 'Password')
    await page.getByTestId('dolphin-lease-profiles').getByText('770032142, 770032143', { exact: false }).waitFor()
    await page.getByTestId('get-verification-code-button').click()
    await page.getByTestId('verification-code-value').getByText('Code: 123456', { exact: false }).waitFor()
    await page.getByTestId('copy-verification-code-button').waitFor()
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-client-dashboard.png'), fullPage: true })
    await page.getByTestId('logout-button').click()
    await page.getByTestId('login-page').waitFor()
    assert.equal(await page.getByTestId('client-dashboard').count(), 0)
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-client-logout.png'), fullPage: true })

    await page.getByTestId('email-input').fill('Nariman')
    await page.locator('input[type="password"]').fill('Nariman')
    await page.getByTestId('login-button').click()
    await page.getByTestId('provider-dashboard').waitFor()
    await assertText(page, 'Ильяс Тохтаран')
    await assertText(page, 'LinkedIn email')
    await assertText(page, 'Shared Dolphin login: kind.cute.unicorn@gmail.com')
    await assertText(page, 'latest.linkedin.one@example.com, latest.linkedin.two@example.com')
    await assertText(page, 'Latest Admin Client')
    assert.equal(await page.getByTestId('open-dolphin-provider-button').count(), 2)
    assert.equal(await page.getByText('Provider Hidden Client').count(), 0)
    assert.equal(await page.getByText('clientStatus', { exact: false }).count(), 0)
    assert.equal(await page.getByText('on en market', { exact: false }).count(), 0)
    const firstProviderClientName = (await page.getByTestId('provider-clients-table').locator('tbody tr').first().locator('td').first().textContent())?.trim()
    assert(firstProviderClientName)
    await wait(15300)
    await page.getByTestId('open-dolphin-provider-button').first().click()
    await page.getByTestId('dolphin-lease-panel').waitFor()
    await assertText(page, 'kind.cute.unicorn@gmail.com')
    await page.getByTestId('dolphin-lease-panel').getByText(firstProviderClientName, { exact: false }).waitFor()
    await page.getByTestId('dolphin-lease-profiles').getByText('800760591, 800760592', { exact: false }).waitFor()
    assert.equal(await page.getByTestId('dolphin-lease-panel').getByText('Latest Admin Client', { exact: false }).count(), 0)
    await assertText(page, 'Ильяс Тохтаран')
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '04-provider-dashboard.png'), fullPage: true })
    await page.getByTestId('logout-button').click()
    await page.getByTestId('login-page').waitFor()
    assert.equal(await page.getByTestId('provider-dashboard').count(), 0)
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '05-provider-logout.png'), fullPage: true })

    await page.getByTestId('email-input').fill('client@example.com')
    await page.locator('input[type="password"]').fill('1234')
    await page.getByTestId('login-button').click()
    await page.getByTestId('client-dashboard').waitFor()
    await page.getByTestId('open-dolphin-client-button').click()
    await page.getByTestId('dolphin-lease-error').waitFor()
    assert.match(await page.getByTestId('dolphin-lease-error').textContent(), /account in use sorry/)
    await page.getByTestId('logout-button').click()
    await page.getByTestId('login-page').waitFor()

    await page.getByTestId('email-input').fill('unicornveryevil@gmail.com')
    await page.locator('input[type="password"]').fill('101010')
    await page.getByTestId('login-button').click()
    await page.getByTestId('admin-dashboard').waitFor()
    await assertText(page, 'Latest Admin Client')
    await assertText(page, 'start HH responses')
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '06-admin-dashboard.png'), fullPage: true })
    await page.getByTestId('start-hh-button').click()
    await page.getByTestId('dry-run-result').waitFor()
    await assertText(page, 'Dry run only')
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '07-admin-dry-run.png'), fullPage: true })
    await page.getByTestId('logout-button').click()
    await page.getByTestId('login-page').waitFor()
    assert.equal(await page.getByTestId('admin-dashboard').count(), 0)
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '08-admin-logout.png'), fullPage: true })
  } finally {
    if (browser) await browser.close()
    await stopProcess(frontend)
    await stopProcess(backend)
  }
}

async function assertText(page: any, text: string): Promise<void> {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: 10000 })
}

runTests()
  .then(() => {
    console.log(`web console e2e tests passed; screenshots written to ${ARTIFACT_DIR}`)
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
