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
    await page.getByTestId('linkedin-history').getByText('Connected Client').waitFor()
    await page.getByTestId('linkedin-account-303').getByTestId('linkedin-error-code').waitFor()
    assert.match(await page.getByTestId('linkedin-auth-tab').innerText(), /dolphin_proxy_unhealthy/)
    await page.getByTestId('linkedin-search').fill('Proxy Error Client')
    assert.equal(await page.locator('[data-testid^="linkedin-account-"]').count(), 1)
    await page.getByTestId('linkedin-search').fill('')
    let verifyConfirmation = ''
    page.once('dialog', (dialog: any) => { verifyConfirmation = dialog.message(); void dialog.dismiss() })
    await page.getByTestId('linkedin-connect-203').click()
    await page.waitForTimeout(50)
    assert.match(verifyConfirmation, /Dolphin will not be restarted/)
    await page.getByTestId('linkedin-url-input-103').fill('https://www.linkedin.com/in/test-client/')
    await page.getByTestId('linkedin-url-save-103').click()
    await page.getByTestId('linkedin-url-edit-103').waitFor()
    page.once('dialog', (dialog: any) => dialog.accept())
    await page.getByTestId('linkedin-connect-103').click()
    await page.getByTestId('linkedin-account-103').getByText('Completed', { exact: true })
      .waitFor({ timeout: 5000 })
    await page.getByTestId('linkedin-history').getByText('Test Client').waitFor()
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
