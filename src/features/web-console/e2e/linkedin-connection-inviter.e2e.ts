const assert = require('node:assert/strict')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '../../../..')
const API_PORT = 4340
const UI_PORT = 4341
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function start(args: string[], env: Record<string, string>) {
  return spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'] })
}

async function waitForHttp(url: string) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).status < 500) return } catch {}
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
    WEB_CONSOLE_PORT: String(API_PORT) })
  const frontend = start([vite, '--config', 'src/features/web-console/frontend/vite.config.js',
    '--host', '127.0.0.1', '--port', String(UI_PORT)], {
    WEB_CONSOLE_API_URL: `http://127.0.0.1:${API_PORT}` })
  let browser: any
  try {
    await waitForHttp(`http://127.0.0.1:${API_PORT}/api/auth/me`)
    await waitForHttp(`http://127.0.0.1:${UI_PORT}`)
    browser = await chromium.launch(); const page = await browser.newPage()
    let fallbackPolls = 0
    let readinessReads = 0
    let historyReads = 0
    const fallbackUrls: string[] = []
    page.on('request', (request: any) => {
      if (/\/api\/admin\/linkedin\/connection-runs\/connections-203$/.test(request.url())) {
        fallbackPolls += 1; fallbackUrls.push(request.url())
      }
      if (/\/api\/admin\/linkedin\/accounts\/203\/connection-readiness$/.test(request.url())) {
        readinessReads += 1
      }
      if (/\/api\/admin\/linkedin\/accounts\/203\/connection-history$/.test(request.url())) {
        historyReads += 1
      }
    })
    await page.goto(`http://127.0.0.1:${UI_PORT}`)
    await page.getByTestId('email-input').fill('unicornveryevil@gmail.com')
    await page.locator('input[type="password"]').fill('101010')
    await page.getByTestId('login-button').click(); await page.getByTestId('admin-linkedin-tab').click()
    const cell = page.getByTestId('connection-inviter-203')
    await cell.getByText('Readiness: checked before run').waitFor()
    await page.getByTestId('connection-run-203').waitFor()
    assert.equal(readinessReads, 0)
    assert.equal(historyReads, 0)
    page.once('dialog', (dialog: any) => dialog.accept())
    await page.getByTestId('connection-run-203').click()
    await page.getByTestId('connection-stop-203').waitFor()
    assert.equal(readinessReads, 1)
    assert.equal(historyReads, 1)
    page.once('dialog', (dialog: any) => dialog.accept())
    await page.getByTestId('connection-stop-203').click()
    await cell.getByText('Stopped', { exact: true }).waitFor()
    page.once('dialog', (dialog: any) => dialog.accept())
    await page.getByTestId('connection-run-203').click()
    await cell.getByText('Completed', { exact: true }).waitFor()
    await page.reload(); await page.getByTestId('admin-linkedin-tab').click()
    const reloadedCell = page.getByTestId('connection-inviter-203')
    await reloadedCell.getByText('Completed', { exact: true }).waitFor()
    await reloadedCell.getByText('Connection history', { exact: true }).waitFor()
    assert.match(await reloadedCell.innerText(), /320 connections/)
    assert.match(await reloadedCell.innerText(), /8 recruiters/)
    assert.match(await reloadedCell.innerText(), /Connection history/)
    assert.equal(fallbackPolls, 0, JSON.stringify(fallbackUrls))
  } finally {
    if (browser) await browser.close(); await stop(frontend); await stop(backend)
  }
}

run().then(() => console.log('linkedin connection inviter e2e passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
