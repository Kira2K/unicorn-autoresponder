const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '../../../..')
const ARTIFACT_DIR = path.join(ROOT, 'tmp', 'web-console-live-telegram')
const BASE_URL = String(process.env.WEB_CONSOLE_LIVE_BASE_URL || 'http://127.0.0.1:4301').replace(/\/$/, '')
const ADMIN_EMAIL = String(process.env.WEB_CONSOLE_LIVE_ADMIN_EMAIL || 'unicornveryevil@gmail.com')
const ADMIN_PASSWORD = String(process.env.WEB_CONSOLE_LIVE_ADMIN_PASSWORD || '101010')
const REQUESTED_ACCOUNT_REFS = new Set(String(process.env.WEB_CONSOLE_LIVE_ACCOUNT_REFS || '').split(',').map(value => value.trim()).filter(Boolean))
const LIVE_CONCURRENCY = Math.max(1, Math.min(Number(process.env.WEB_CONSOLE_LIVE_CONCURRENCY) || 1, 3))
const LIVE_SCAN_ONLY = process.env.WEB_CONSOLE_LIVE_SCAN_ONLY === 'true'
const LIVE_REMOTE_READ_TIMEOUT_MS = Math.max(90_000, Number(process.env.WEB_CONSOLE_LIVE_REMOTE_READ_TIMEOUT_MS) || 190_000)

type LiveAccountResult = {
  accountRef: string
  baseline: {
    main: { ok: boolean; count: number; privateOnly: boolean; code?: string }
    archive: { ok: boolean; count: number; privateOnly: boolean; code?: string }
    history: { attempted: boolean; ok: boolean; count: number; code?: string }
  }
  scan: {
    outcome: string
    stage: string
    code?: string
    discoveredCount: number
    matchedCount: number
    mainComplete: boolean
    archiveComplete: boolean
    privateOnly: boolean
  }
  postScan: { ok: boolean; count: number; privateOnly: boolean; code?: string }
  regression: boolean
}

async function run(): Promise<void> {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const startedAt = new Date().toISOString()
  try {
    if (LIVE_SCAN_ONLY) {
      const loginResponse = await page.request.post(`${BASE_URL}/api/auth/login`, {
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        timeout: 30000
      })
      if (!loginResponse.ok()) throw new Error(`Live admin login failed with ${loginResponse.status()}`)
      await page.goto(`${BASE_URL}/api/auth/me`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    } else {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
      if (await page.getByTestId('login-page').count()) {
        await page.getByTestId('email-input').fill(ADMIN_EMAIL)
        await page.locator('input[type="password"]').fill(ADMIN_PASSWORD)
        await page.getByTestId('login-button').click()
      }
    }
    if (!LIVE_SCAN_ONLY) {
      await page.getByTestId('admin-dashboard').waitFor({ timeout: 30000 })
      await page.getByTestId('admin-dialogs-card').waitFor({ timeout: 30000 })
      if (await page.getByTestId('admin-dialogs-toggle').getAttribute('aria-expanded') === 'true') {
        await page.getByTestId('admin-dialogs-toggle').click()
      }
    }

    const allAccounts = await page.evaluate(async () => {
      const response = await fetch('/api/admin/telegram/senders', { credentials: 'include' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error || body?.message || `Sender catalog failed with ${response.status}`)
      return (body.senders || []).map((sender: any) => ({
        clientId: Number(sender.clientId),
        accountId: Number(sender.accountId)
      }))
    })
    const catalog = REQUESTED_ACCOUNT_REFS.size
      ? allAccounts.filter((sender: any) => REQUESTED_ACCOUNT_REFS.has(`${sender.clientId}:${sender.accountId}`))
      : allAccounts
    assert.ok(catalog.length > 0, 'No active Telegram senders were returned by the local application.')

    const results: LiveAccountResult[] = []
    const writeArtifact = async () => {
      const coverageText = LIVE_SCAN_ONLY
        ? ''
        : await page.getByTestId('admin-dialog-account-coverage').textContent().catch(() => '')
      const artifact = {
        baseUrl: BASE_URL,
        startedAt,
        completedAt: new Date().toISOString(),
        eligibleAccounts: catalog.length,
        coverageText: String(coverageText || '').trim(),
        results: [...results].sort((left, right) => left.accountRef.localeCompare(right.accountRef))
      }
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'summary.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
    }
    let cursor = 0
    async function verifyNextAccount(): Promise<void> {
      while (true) {
        const index = cursor++
        if (index >= catalog.length) return
        const sender = catalog[index]
        const result = await page.evaluate(async ({ clientId, accountId, scanOnly, liveRemoteReadTimeoutMs }: { clientId: number; accountId: number; scanOnly: boolean; liveRemoteReadTimeoutMs: number }) => {
          const query = (extra: Record<string, string | number>) => {
            const params = new URLSearchParams({
              targetClientId: String(clientId),
              platformAccountId: String(accountId)
            })
            for (const [key, value] of Object.entries(extra)) params.set(key, String(value))
            return params
          }
          const safeFetch = async (url: string, timeoutMs: number) => {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), timeoutMs)
            try {
              const response = await fetch(url, { credentials: 'include', signal: controller.signal })
              const body = await response.json().catch(() => ({}))
              return { ok: response.ok, status: response.status, body, code: body?.error || body?.accountResult?.error?.code }
            } catch (error: any) {
              return { ok: false, status: 0, body: {}, code: error?.name === 'AbortError' ? 'request_timeout' : 'transport_error' }
            } finally {
              clearTimeout(timer)
            }
          }
          const main = scanOnly
            ? { ok: false, status: 0, body: {}, code: 'skipped' }
            : await safeFetch(`/api/telegram/dialogs?${query({ list: 'main', limit: 50, privateOnly: 'true' })}`, 75000)
          const archive = scanOnly
            ? { ok: false, status: 0, body: {}, code: 'skipped' }
            : await safeFetch(`/api/telegram/dialogs?${query({ list: 'archive', limit: 50, privateOnly: 'true' })}`, 75000)
          const firstChatId = main.ok
            ? main.body?.dialogs?.[0]?.id
            : archive.ok
              ? archive.body?.dialogs?.[0]?.id
              : undefined
          const history = firstChatId
            ? await safeFetch(`/api/telegram/messages?${query({ chatId: firstChatId, limit: 1 })}`, liveRemoteReadTimeoutMs)
            : null
          const scan = await safeFetch(`/api/admin/telegram/dialogs/scan?${query({ days: 1 })}`, liveRemoteReadTimeoutMs)
          const post = scanOnly
            ? { ok: false, status: 0, body: {}, code: 'skipped' }
            : await safeFetch(`/api/telegram/dialogs?${query({ list: 'main', limit: 1, privateOnly: 'true' })}`, liveRemoteReadTimeoutMs)
          const accountResult = scan.body?.accountResult || {}
          const baselineReady = main.ok && archive.ok
          const mainPrivateOnly = Array.isArray(main.body?.dialogs) && main.body.dialogs.every((dialog: any) => dialog?.isPrivate === true)
          const archivePrivateOnly = Array.isArray(archive.body?.dialogs) && archive.body.dialogs.every((dialog: any) => dialog?.isPrivate === true)
          const scanPrivateOnly = Array.isArray(scan.body?.rows) && scan.body.rows.every((row: any) => row?.isPrivate === true)
          const postPrivateOnly = Array.isArray(post.body?.dialogs) && post.body.dialogs.every((dialog: any) => dialog?.isPrivate === true)
          return {
            accountRef: `${clientId}:${accountId}`,
            baseline: {
              main: { ok: main.ok, count: Array.isArray(main.body?.dialogs) ? main.body.dialogs.length : 0, privateOnly: mainPrivateOnly, ...(main.code ? { code: String(main.code) } : {}) },
              archive: { ok: archive.ok, count: Array.isArray(archive.body?.dialogs) ? archive.body.dialogs.length : 0, privateOnly: archivePrivateOnly, ...(archive.code ? { code: String(archive.code) } : {}) },
              history: history
                ? { attempted: true, ok: history.ok, count: Array.isArray(history.body?.messages) ? history.body.messages.length : 0, ...(history.code ? { code: String(history.code) } : {}) }
                : { attempted: false, ok: false, count: 0 }
            },
            scan: {
              outcome: String(accountResult.outcome || (scan.ok ? 'unknown' : 'transport_failed')),
              stage: String(accountResult.stage || 'unknown'),
              ...(accountResult.error?.code || scan.code ? { code: String(accountResult.error?.code || scan.code) } : {}),
              discoveredCount: Number(accountResult.discoveredCount) || 0,
              matchedCount: Number(accountResult.matchedCount) || 0,
              mainComplete: accountResult.lists?.main?.complete === true,
              archiveComplete: accountResult.lists?.archive?.complete === true,
              privateOnly: scanPrivateOnly
            },
            postScan: {
              ok: post.ok,
              count: Array.isArray(post.body?.dialogs) ? post.body.dialogs.length : 0,
              privateOnly: postPrivateOnly,
              ...(post.code ? { code: String(post.code) } : {})
            },
            regression: baselineReady && (
              !mainPrivateOnly ||
              !archivePrivateOnly ||
              accountResult.outcome !== 'complete' ||
              accountResult.lists?.main?.complete !== true ||
              accountResult.lists?.archive?.complete !== true ||
              !scanPrivateOnly ||
              !post.ok ||
              !postPrivateOnly
            )
          }
        }, { ...sender, scanOnly: LIVE_SCAN_ONLY, liveRemoteReadTimeoutMs: LIVE_REMOTE_READ_TIMEOUT_MS })
        results.push(result)
        await writeArtifact()
      }
    }
    await Promise.all(Array.from({ length: Math.min(LIVE_CONCURRENCY, catalog.length) }, () => verifyNextAccount()))
    await writeArtifact()
    console.log(JSON.stringify({
      eligibleAccounts: catalog.length,
      complete: results.filter(result => result.scan.outcome === 'complete').length,
      regressions: results.filter(result => result.regression).map(result => ({ accountRef: result.accountRef, stage: result.scan.stage, code: result.scan.code }))
    }))
    assert.deepEqual(
      results.filter(result => result.regression).map(result => result.accountRef),
      [],
      'Accounts that pass deployed dialogs must also complete the new read-only scan.'
    )
  } finally {
    await browser.close()
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
