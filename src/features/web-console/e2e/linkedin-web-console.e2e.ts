const assert = require('node:assert/strict')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '../../../..')
const API_PORT = 4320
const UI_PORT = 4321

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function start(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (data: Buffer) => process.stdout.write(String(data)))
  child.stderr.on('data', (data: Buffer) => process.stderr.write(String(data)))
  return child
}

async function waitForHttp(url: string) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).status < 500) return
    } catch {}
    await wait(250)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function stop(child: any) {
  if (child.exitCode === null && !child.killed) child.kill()
  await wait(300)
}

async function run() {
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
  const backend = start(['src/features/web-console/backend/index.ts'], {
    WEB_CONSOLE_USE_MOCK_DATA: 'true', WEB_CONSOLE_HOST: '127.0.0.1',
    WEB_CONSOLE_PORT: String(API_PORT)
  })
  const frontend = start([vite, '--config', 'src/features/web-console/frontend/vite.config.js',
    '--host', '127.0.0.1', '--port', String(UI_PORT)], {
    WEB_CONSOLE_API_URL: `http://127.0.0.1:${API_PORT}`
  })
  let browser: any
  try {
    await waitForHttp(`http://127.0.0.1:${API_PORT}/api/auth/me`)
    await waitForHttp(`http://127.0.0.1:${UI_PORT}`)
    browser = await chromium.launch()
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${UI_PORT}`)
    await page.getByTestId('email-input').fill('unicornveryevil@gmail.com')
    await page.locator('input[type="password"]').fill('101010')
    await page.getByTestId('login-button').click()
    await page.getByTestId('admin-dashboard').waitFor()
    await page.getByTestId('admin-linkedin-tab').click()
    await page.getByTestId('linkedin-auth-tab').waitFor()
    await page.getByTestId('linkedin-history-run-mock-history-1')
      .getByText('Connected Client').waitFor()
    await page.getByTestId('linkedin-history-retry-mock-history-url').getByText('Fix URL').waitFor()
    await page.getByTestId('linkedin-history-retry-mock-history-reconnect').getByText('Reconnect').waitFor()
    await page.getByTestId('linkedin-account-303').getByTestId('linkedin-error-code').waitFor()
    assert.match(await page.getByTestId('linkedin-auth-tab').innerText(), /dolphin_proxy_unhealthy/)
    await page.getByTestId('linkedin-search').fill('Proxy Error Client')
    assert.equal(await page.locator('[data-testid^="linkedin-account-"]').count(), 1)
    assert.equal(await page.locator('[data-testid^="linkedin-history-run-"]').count(), 0)
    await page.getByTestId('linkedin-search').fill('')
    let verifyConfirmation = ''
    page.once('dialog', (dialog: any) => { verifyConfirmation = dialog.message(); void dialog.dismiss() })
    await page.getByTestId('linkedin-connect-203').click()
    await page.waitForTimeout(50)
    assert.match(verifyConfirmation, /Dolphin will not be restarted/)
    await page.getByTestId('profile-filler-203').click()
    await page.getByTestId('profile-json-tools').locator('summary').click()
    await page.getByTestId('profile-filler-file').setInputFiles({
      name: 'profile.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ headline: 'New headline' }))
    })
    await page.getByTestId('profile-draft-editor').waitFor()
    await page.getByTestId('profile-analysis-issues').getByText('Структура документа исправлена автоматически.').waitFor()
    await page.getByTestId('profile-filler-preview').click()
    await page.getByTestId('profile-filler-apply').waitFor()
    await page.getByText('Для специалиста: редактирование JSON', { exact: true }).click()
    await page.getByTestId('profile-draft-editor').locator('input').first().fill('Edited headline')
    assert.equal(await page.getByTestId('profile-filler-apply').isDisabled(), true)
    await page.getByTestId('profile-filler-recheck').click()
    await page.waitForFunction(() =>
      !(document.querySelector('[data-testid="profile-filler-apply"]') as HTMLButtonElement)?.disabled)
    assert.equal(await page.getByTestId('profile-filler-apply').isEnabled(), true)
    await page.getByTestId('profile-filler-apply').click()
    await page.getByTestId('profile-confirm-submit').click()
    await page.getByTestId('profile-result-title').getByText('Профиль заполнен и проверен', { exact: true }).waitFor()
    await page.getByTestId('profile-result').getByText('Подтверждено', { exact: false }).waitFor()
    await page.getByTestId('profile-overall-timer').waitFor()
    await page.getByTestId('profile-result').locator('.pi-check-circle').waitFor()
    await page.getByTestId('profile-filler-history').locator('summary').click()
    await page.getByTestId('profile-filler-history').getByText('Профиль заполнен и проверен', { exact: true })
      .waitFor({ timeout: 5000 })
    const rollbackButton = page.getByTestId('profile-filler-rollback')
    await rollbackButton.click()
    await page.getByTestId('profile-confirm-submit').click()
    await rollbackButton.waitFor({ state: 'hidden' })
    await page.getByTestId('profile-result-title').getByText('Профиль заполнен и проверен', { exact: true })
      .waitFor({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await page.locator('.profile-filler-dialog').waitFor({ state: 'hidden' })
    await page.getByTestId('profile-filler-203').click()
    await page.getByTestId('profile-generation-restart').click()
    await page.getByTestId('profile-filler-generate').click()
    await page.getByTestId('profile-generation-restart').waitFor({ timeout: 5000 })
    assert.equal(await page.getByTestId('profile-draft-editor').count(), 0)
    assert.equal(await page.getByTestId('profile-filler-recheck').count(), 0)
    await page.getByTestId('profile-generation-restart').click()
    await page.getByTestId('profile-filler-generate').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.profile-filler-dialog').waitFor({ state: 'hidden' })
    await page.getByTestId('linkedin-url-input-103').fill('https://www.linkedin.com/in/test-client/')
    await page.getByTestId('linkedin-url-save-103').click()
    await page.getByTestId('linkedin-url-edit-103').waitFor()
    page.once('dialog', (dialog: any) => dialog.accept())
    await page.getByTestId('linkedin-connect-103').click()
    await page.getByTestId('linkedin-account-103').getByText('Completed', { exact: true })
      .waitFor({ timeout: 5000 })
    await page.getByTestId('linkedin-history').getByText('Test Client').first().waitFor()
    await (require('./profile-observation-check.ts') as {
      checkProfileObservation(page: import('playwright').Page): Promise<void>
    }).checkProfileObservation(page)
    await (require('./profile-desktop-check.ts') as {
      checkProfileDesktop(page: import('playwright').Page): Promise<void>
    }).checkProfileDesktop(page)
  } finally {
    if (browser) await browser.close()
    await stop(frontend)
    await stop(backend)
  }
}

run().then(() => console.log('linkedin web console e2e passed')).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
