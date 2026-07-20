const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '../../../..')
const ARTIFACT_DIR = path.join(ROOT, 'tmp', 'web-console-e2e')
const TDLIB_E2E_ROOT = path.join(ARTIFACT_DIR, `tdlib-${process.pid}-${Date.now()}`)
const AI_TAILOR_FIXTURE_DIR = path.join(ROOT, 'src', 'features', 'web-console', 'test-fixtures', 'ai-tailoring')
const AI_TAILOR_PDF = path.join(AI_TAILOR_FIXTURE_DIR, 'Kira Samsonova React.pdf')
const AI_TAILOR_JOB_REQUIREMENTS = fs.readFileSync(path.join(AI_TAILOR_FIXTURE_DIR, 'AI-tailor-test-text.txt'), 'utf8')
const API_PORT = 4310
const UI_PORT = 4311
const MOCK_PLATFORM_LABELS = ['email_en', 'hh_ru', 'linkedin', 'telegram_ru']

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
    WEB_CONSOLE_TELEGRAM_MODE: 'local',
    WEB_CONSOLE_DOLPHIN_LEASE_DRY_RUN: 'true',
    DOLPHIN_SHARED_USER_LEASE_MS: '15000',
    TELEGRAM_TDLIB_ROOT: TDLIB_E2E_ROOT,
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

    let initialClientStatusSeen = false
    let initialClientStatusPending = false
    let releaseInitialClientStatus!: () => void
    const initialClientStatusGate = new Promise<void>(resolve => { releaseInitialClientStatus = resolve })
    const slowInitialClientStatus = async (route: any) => {
      if (initialClientStatusSeen) {
        await route.continue()
        return
      }
      initialClientStatusSeen = true
      initialClientStatusPending = true
      await initialClientStatusGate
      initialClientStatusPending = false
      await route.continue()
    }
    await page.route('**/api/telegram/status?*', slowInitialClientStatus)
    await page.getByTestId('email-input').fill('client@example.com')
    await page.locator('input[type="password"]').fill('1234')
    await page.getByTestId('login-button').click()
    await page.getByTestId('client-dashboard').waitFor()
    const clientStatusRouteDeadline = Date.now() + 2000
    while (!initialClientStatusSeen && Date.now() < clientStatusRouteDeadline) await wait(10)
    assert.equal(initialClientStatusSeen, true)
    assert.equal(initialClientStatusPending, true, 'client dashboard must render while live Telegram status is pending')
    releaseInitialClientStatus()
    while (initialClientStatusPending) await wait(10)
    await page.unroute('**/api/telegram/status?*', slowInitialClientStatus)
    await assertText(page, 'Test')
    assert.equal(await page.getByTestId('profile-form').isVisible(), false)
    await page.getByTestId('profile-details-accordion-header').waitFor()
    await page.getByTestId('open-profile-editor-button').click()
    await page.getByTestId('profile-form').waitFor()
    await page.getByTestId('profile-first-name').fill('Testy')
    await page.getByTestId('profile-last-name').fill('McClient')
    await page.getByTestId('profile-fio').fill('Testy McClient Legal')
    await page.getByTestId('profile-birth-date').fill('2002-03-04')
    await page.getByTestId('profile-education').fill('QA University')
    await page.getByTestId('profile-calendar-email').fill('client@example.com')
    await page.getByTestId('profile-telegram').fill('@testy_client')
    await page.getByTestId('profile-english-level').selectOption({ label: 'B2' })
    await page.getByTestId('save-profile-button').click()
    await page.getByTestId('profile-save-message').getByText('Profile saved', { exact: false }).waitFor()
    await page.getByTestId('profile-details-accordion-header').click()
    await assertText(page, 'QA University')
    await assertText(page, 'Testy')
    await assertText(page, 'McClient')
    await page.getByTestId('accounts-table').getByText('hh_ru', { exact: false }).first().waitFor()
    assert.equal(await page.getByTestId('account-form').count(), 0)
    await page.getByTestId('open-account-editor-button').click()
    await page.getByTestId('account-form').waitFor()
    await page.getByTestId('account-platform').selectOption({ label: 'linkedin' })
    await page.getByTestId('account-label').fill('Test LinkedIn')
    await page.getByTestId('account-login').fill('test.linkedin@example.com')
    await page.getByTestId('account-phone').fill('+15550101010')
    await page.getByTestId('account-email').fill('test.linkedin@example.com')
    await page.getByTestId('account-nickname').fill('test-li')
    await page.getByTestId('account-linkedin-url').fill('https://linkedin.com/in/test')
    await page.getByTestId('account-foreign-number').fill('+442071234567')
    await page.getByTestId('account-recovery-codes').fill('code-a')
    await page.getByTestId('account-password-widget').locator('input').fill('secret-one')
    await page.getByTestId('account-email-password-widget').locator('input').fill('mail-secret-one')
    await page.getByTestId('save-account-button').click()
    await page.getByTestId('account-save-message').getByText('Account added', { exact: false }).waitFor()
    await assertText(page, 'Test LinkedIn')
    await assertText(page, 'test.linkedin@example.com')
    await page.getByTestId('edit-account-button').last().click()
    await page.getByTestId('account-label').fill('Test LinkedIn Edited')
    await page.getByTestId('account-login').fill('edited.linkedin@example.com')
    await page.getByTestId('account-password-widget').locator('input').fill('secret-two')
    await page.getByTestId('save-account-button').click()
    await page.getByTestId('account-save-message').getByText('Account updated', { exact: false }).waitFor()
    await assertText(page, 'Test LinkedIn Edited')
    await assertText(page, 'edited.linkedin@example.com')
    await assertText(page, '***')
    page.once('dialog', (dialog: any) => dialog.accept())
    await page.getByTestId('delete-account-button').last().click()
    await page.getByTestId('account-save-message').getByText('Account deleted', { exact: false }).waitFor()
    assert.equal(await page.getByText('Test LinkedIn Edited').count(), 0)

    await page.getByTestId('telegram-card').waitFor()
    assert.equal(await page.locator('[data-testid^="telegram-account-tab-"]').count(), 2)
    await page.getByTestId('telegram-account-tab-102').getByText('Kira Telegram Ru', { exact: false }).waitFor()
    await page.getByTestId('telegram-account-tab-104').getByText('Kira Telegram En', { exact: false }).waitFor()
    await page.getByTestId('telegram-phone').fill('+79990001122')
    await page.getByTestId('telegram-connect-button').click()
    await page.getByTestId('telegram-code').waitFor()
    await page.getByTestId('telegram-code').fill('12345')
    await page.getByTestId('telegram-connect-button').click()
    await page.getByTestId('telegram-status').getByText('active', { exact: false }).waitFor()
    await page.getByTestId('telegram-account-tab-104').click()
    await page.getByTestId('telegram-status').getByText('disconnected', { exact: false }).waitFor()
    await page.getByTestId('telegram-connect-button').click()
    await page.getByTestId('telegram-code').waitFor()
    await page.getByTestId('telegram-code').fill('12345')
    await page.getByTestId('telegram-connect-button').click()
    await page.getByTestId('telegram-status').getByText('active', { exact: false }).waitFor()
    await page.getByTestId('telegram-account-tab-102').click()
    await page.getByTestId('telegram-status').getByText('active', { exact: false }).waitFor()
    await page.getByTestId('telegram-open-button').click()
    await page.getByTestId('telegram-workspace').waitFor()
    let lateClientHistorySeen = false
    const delayedClientHistory = async (route: any) => {
      const chatId = new URL(route.request().url()).searchParams.get('chatId')
      if (chatId === 'reporting-chat') {
        lateClientHistorySeen = true
        await wait(600)
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ messages: [{ id: 'late-client', text: 'Late client history must be ignored' }] })
        }).catch(() => {})
        return
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ messages: [{ id: 'fresh-client', text: 'Fresh client history' }] })
      })
    }
    await page.route('**/api/telegram/messages?*', delayedClientHistory)
    await page.getByTestId('telegram-workspace').getByText('Current reporting chat', { exact: false }).click()
    while (!lateClientHistorySeen) await wait(10)
    await page.getByTestId('telegram-workspace').getByText('Client messages', { exact: false }).click()
    await page.getByTestId('telegram-workspace').getByText('Fresh client history', { exact: false }).waitFor()
    await page.waitForTimeout(700)
    assert.equal(await page.getByText('Late client history must be ignored', { exact: false }).count(), 0)
    await page.unroute('**/api/telegram/messages?*', delayedClientHistory)
    await page.getByTestId('telegram-workspace').getByText('Current reporting chat', { exact: false }).click()
    await page.getByTestId('telegram-search-input').fill('client')
    await page.getByTestId('telegram-search-button').click()
    await page.getByTestId('telegram-workspace').getByText('Client messages', { exact: false }).waitFor()
    await page.getByTestId('telegram-workspace').getByText('@client_partner', { exact: false }).waitFor()
    await page.getByTestId('telegram-username-copy-button').click()
    await page.getByTestId('telegram-copy-status').getByText('Copied @client_partner', { exact: false }).waitFor()
    assert.equal(await page.getByTestId('telegram-workspace').getByText('Telegram session is ready.', { exact: false }).count(), 0)
    await page.getByTestId('telegram-workspace').getByText('Client messages', { exact: false }).click()
    await page.getByTestId('telegram-contact-form').waitFor()
    assert.equal(await page.getByTestId('telegram-message-input').isDisabled(), true)
    assert.equal(await page.getByTestId('telegram-send-button').isDisabled(), true)
    await page.getByTestId('telegram-write-toggle').getByText('Read-only', { exact: false }).waitFor()
    assert.equal(
      await page.getByTestId('telegram-write-toggle').getAttribute('title'),
      "in readonly mode you can't send messages, but also doesn't trigger unread messages status"
    )
    await page.getByTestId('telegram-write-toggle').click()
    await page.getByTestId('telegram-write-toggle').getByText('Writing enabled', { exact: false }).waitFor()
    assert.equal(await page.getByTestId('telegram-message-input').isDisabled(), false)
    await page.getByTestId('telegram-message-input').fill('readonly toggle e2e send')
    await page.getByTestId('telegram-send-button').click()
    await page.getByTestId('telegram-workspace').getByText('readonly toggle e2e send', { exact: false }).waitFor()
    await page.getByTestId('telegram-write-toggle').click()
    await page.getByTestId('telegram-write-toggle').getByText('Read-only', { exact: false }).waitFor()
    assert.equal(await page.getByTestId('telegram-message-input').isDisabled(), true)
    await page.getByTestId('telegram-contact-first-name').fill('Safe')
    await page.getByTestId('telegram-contact-last-name').fill('Lead')
    await page.getByTestId('telegram-contact-save-button').click()
    await page.getByTestId('telegram-contact-status').getByText('Saved on Telegram', { exact: false }).waitFor()
    await page.getByTestId('telegram-workspace').getByText('Safe Lead', { exact: false }).waitFor()
    await page.getByTestId('telegram-search-input').fill('')
    await page.getByTestId('telegram-folder-select').selectOption('archive')
    await page.getByTestId('telegram-workspace').getByText('Archived lead', { exact: false }).waitFor()
    await page.getByTestId('telegram-hide-button').click()
    assert.equal(await page.getByTestId('telegram-workspace').count(), 0)
    await page.getByTestId('telegram-status').getByText('active', { exact: false }).waitFor()

    for (const platformLabel of MOCK_PLATFORM_LABELS) {
      const label = `All platforms ${platformLabel}`
      await page.getByTestId('open-account-editor-button').click()
      await page.getByTestId('account-form').waitFor()
      await page.getByTestId('account-platform').selectOption({ label: platformLabel })
      await page.getByTestId('account-label').fill(label)
      await page.getByTestId('account-login').fill(`all-${platformLabel}@example.com`)
      await page.getByTestId('account-phone').fill(`+1555000${MOCK_PLATFORM_LABELS.indexOf(platformLabel) + 1}`)
      await page.getByTestId('account-email').fill(`all-${platformLabel}@example.com`)
      await page.getByTestId('account-nickname').fill(`all-${platformLabel}`)
      await page.getByTestId('account-linkedin-url').fill(`https://example.com/${platformLabel}`)
      await page.getByTestId('account-foreign-number').fill(`+44207000${MOCK_PLATFORM_LABELS.indexOf(platformLabel) + 1}`)
      await page.getByTestId('account-recovery-codes').fill(`recovery-${platformLabel}`)
      await page.getByTestId('account-password-widget').locator('input').fill(`secret-${platformLabel}`)
      await page.getByTestId('account-email-password-widget').locator('input').fill(`mail-secret-${platformLabel}`)
      await page.getByTestId('save-account-button').click()
      await page.getByTestId('account-save-message').getByText('Account added', { exact: false }).waitFor()
      await page.getByTestId('accounts-table').getByText(label, { exact: true }).waitFor()
      if (platformLabel === 'telegram_ru') {
        assert.equal(await page.locator('[data-testid^="telegram-account-tab-"]').count(), 3)
        await page.getByTestId('telegram-status').getByText('disconnected', { exact: false }).waitFor()
      }
    }

    assert.equal(await page.getByTestId('account-form').count(), 0)
    for (const platformLabel of MOCK_PLATFORM_LABELS) {
      await page.getByTestId('accounts-table').getByText(`All platforms ${platformLabel}`, { exact: true }).waitFor()
      await page.getByTestId('accounts-table').getByText(`all-${platformLabel}@example.com`, { exact: false }).first().waitFor()
    }
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-client-all-platform-accounts.png'), fullPage: true })

    await page.getByTestId('open-dolphin-client-button').getByText('Open Dolphin profiles', { exact: false }).waitFor()
    assert.equal(await page.getByTestId('own-proxy-panel').count(), 0)
    await page.getByTestId('open-dolphin-client-button').click()
    await page.getByTestId('secure-dns-warning').waitFor()
    await page.getByTestId('secure-dns-warning').getByText('Are you sure you have switched secure DNS off before opening LinkedIn?', { exact: false }).waitFor()
    await page.getByTestId('confirm-secure-dns-warning-button').click()
    await page.getByTestId('dolphin-lease-panel').waitFor()
    await page.getByTestId('dolphin-lease-panel').getByText('Test', { exact: false }).waitFor()
    await assertText(page, 'Dolphin access')
    await assertText(page, 'Open Dolphin Anty and enter the credentials below.')
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

    await wait(15300)
    await page.getByTestId('email-input').fill('missing-profiles@example.com')
    await page.locator('input[type="password"]').fill('1234')
    await page.getByTestId('login-button').click()
    await page.getByTestId('client-dashboard').waitFor()
    await assertText(page, 'Mock Missing Profiles')
    await page.getByTestId('open-dolphin-client-button').getByText('Create new profiles', { exact: false }).waitFor()
    await page.getByTestId('own-proxy-panel').waitFor()
    assert.equal(await page.getByTestId('expected-proxy-name').count(), 0)
    await page.getByTestId('open-dolphin-client-button').click()
    await page.getByTestId('dolphin-lease-panel').waitFor()
    await page.getByTestId('dolphin-lease-profiles').getByText('880000001, 880000002', { exact: false }).waitFor()
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03b-client-created-profiles.png'), fullPage: true })
    await wait(15300)
    await page.getByTestId('open-dolphin-client-button').click()
    await page.getByTestId('dolphin-lease-profiles').getByText('880000001, 880000002', { exact: false }).waitFor()
    assert.equal(await page.getByTestId('dolphin-lease-profiles').getByText('880000003', { exact: false }).count(), 0)
    await page.getByTestId('logout-button').click()
    await page.getByTestId('login-page').waitFor()

    await page.getByTestId('email-input').fill('Nariman')
    await page.locator('input[type="password"]').fill('Nariman')
    await page.getByTestId('login-button').click()
    await page.getByTestId('provider-dashboard').waitFor()
    assert.equal(await page.getByTestId('admin-ai-tailor-open-button').count(), 0)
    assert.equal(await page.getByTestId('admin-telegram-open-button').count(), 0)
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
    assert.equal(await page.getByTestId('admin-ai-tailor-open-button').count(), 0)
    await dismissRequiredDataDialogIfVisible(page)
    await page.getByTestId('open-dolphin-client-button').click()
    await page.getByTestId('dolphin-lease-error').waitFor()
    assert.match(await page.getByTestId('dolphin-lease-error').textContent(), /come back in 5 mins/)
    await page.getByTestId('logout-button').click()
    await page.getByTestId('login-page').waitFor()

    await page.getByTestId('email-input').fill('missing-name@example.com')
    await page.locator('input[type="password"]').fill('1234')
    await page.getByTestId('login-button').click()
    await page.getByTestId('client-dashboard').waitFor()
    await page.getByTestId('open-dolphin-client-button').click()
    await page.getByTestId('required-data-dialog').waitFor()
    assert.match(await page.getByTestId('required-data-dialog-text').textContent(), /pls contact your mentor to add last name/i)
    await page.getByTestId('confirm-required-data-dialog-button').click()
    await page.getByTestId('logout-button').click()
    await page.getByTestId('login-page').waitFor()

    let initialAdminDialogPending = false
    let initialAdminDialogSeen = false
    let initialAdminStatusPending = false
    let initialAdminStatusSeen = false
    const slowInitialAdminSenders = async (route: any) => {
      initialAdminDialogSeen = true
      initialAdminDialogPending = true
      await wait(1200)
      initialAdminDialogPending = false
      await route.continue()
    }
    const slowInitialAdminStatus = async (route: any) => {
      const url = new URL(route.request().url())
      if (!url.searchParams.has('targetClientId')) return await route.continue()
      initialAdminStatusSeen = true
      initialAdminStatusPending = true
      await wait(1200)
      initialAdminStatusPending = false
      await route.continue()
    }
    const addCurrentAdminTelegramAccount = async (route: any) => {
      const response = await route.fetch()
      const dashboard = await response.json()
      dashboard.platformAccounts = [
        ...(dashboard.platformAccounts || []),
        {
          id: 999001,
          clientId: dashboard.client?.id,
          platform: 'telegram',
          isTelegramAccount: true,
          accountLabel: 'E2E current-client Telegram',
          login: '@e2e_current_client',
          phone: '',
          email: ''
        }
      ]
      await route.fulfill({ response, json: dashboard })
    }
    await page.route('**/api/admin/latest-client', addCurrentAdminTelegramAccount)
    await page.route('**/api/admin/telegram/senders', slowInitialAdminSenders)
    await page.route('**/api/telegram/status?*', slowInitialAdminStatus)
    await page.getByTestId('email-input').fill('unicornveryevil@gmail.com')
    await page.locator('input[type="password"]').fill('101010')
    await page.getByTestId('login-button').click()
    await page.getByTestId('admin-dashboard').waitFor()
    await assertText(page, 'Latest Admin Client')
    await page.waitForTimeout(100)
    assert.equal(initialAdminDialogSeen, true)
    assert.equal(initialAdminDialogPending, true)
    assert.equal(initialAdminStatusSeen, true)
    assert.equal(initialAdminStatusPending, true)
    await page.getByTestId('get-verification-code-button').waitFor()
    await page.getByTestId('admin-dialogs-loading').waitFor()
    assert.equal(await page.getByTestId('telegram-card').count(), 0)
    assert.equal(await page.getByTestId('own-proxy-panel').count(), 0)
    assert.equal(await page.getByTestId('open-dolphin-admin-button').count(), 0)
    await page.getByTestId('admin-dialogs-card').waitFor()
    assert.equal(await page.getByTestId('admin-dialog-days').inputValue(), '1')
    await page.getByTestId('admin-dialogs-table').waitFor()
    await page.getByTestId('admin-dialog-account-coverage').getByText(/Accounts loaded: \d+\/\d+.*Full scans: 0\/\d+/).waitFor()
    await page.unroute('**/api/admin/telegram/senders', slowInitialAdminSenders)
    await page.unroute('**/api/telegram/status?*', slowInitialAdminStatus)
    await page.unroute('**/api/admin/latest-client', addCurrentAdminTelegramAccount)

    await page.getByTestId('admin-dialog-market').selectOption({ index: 1 })
    await page.getByTestId('admin-dialog-stack').selectOption({ index: 1 })
    await page.getByTestId('admin-dialog-apply').click()
    await page.getByTestId('admin-dialogs-table').waitFor()
    await page.locator('[data-testid^="admin-dialog-messages-"]').first().click()
    await page.getByTestId('admin-dialogs-table').getByText('Telegram session is ready.', { exact: false }).first().waitFor()
    await page.getByTestId('admin-dialog-reset').click()
    assert.equal(await page.getByTestId('admin-dialog-days').inputValue(), '1')
    await page.getByTestId('admin-dialogs-table').waitFor()
    await page.getByTestId('admin-dialogs-toggle').click()
    assert.equal(await page.getByTestId('admin-dialog-filters').count(), 0)
    await page.getByTestId('admin-dialogs-toggle').click()
    await page.getByTestId('admin-dialog-filters').waitFor()

    let delayedHistorySeen = false
    const delayedHistory = async (route: any) => {
      delayedHistorySeen = true
      await wait(600)
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ messages: [{ id: 'late', text: 'Late history must stay collapsed', date: new Date().toISOString() }] })
      }).catch(() => {})
    }
    await page.route('**/api/telegram/messages?*', delayedHistory)
    const historyButton = page.locator('[data-testid^="admin-dialog-messages-"]').first()
    await historyButton.click()
    while (!delayedHistorySeen) await wait(10)
    await historyButton.click()
    await page.waitForTimeout(700)
    assert.equal(await page.getByText('Late history must stay collapsed', { exact: false }).count(), 0)
    await historyButton.getByText('Load messages', { exact: false }).waitFor()
    await page.unroute('**/api/telegram/messages?*', delayedHistory)

    let scenario = 'fresh'
    let delayedCatalogSeen = false
    let eagerHistoryRequests = 0
    let scanRequests = 0
    let activeSnapshotRequests = 0
    let maxActiveSnapshotRequests = 0
    let activeScanRequests = 0
    let maxActiveScanRequests = 0
    const scenarioSenders = async (route: any) => {
      const definitions: Record<string, any[]> = {
        slow: [{ clientId: 101, clientName: 'Stale client', accountId: 101, accountLabel: 'Stale account', market: 'Ru', stack: 'Frontend' }],
        fresh: [{ clientId: 102, clientName: 'Fresh client', accountId: 102, accountLabel: 'Fresh account', market: 'En', stack: 'Backend' }],
        partial: [
          { clientId: 201, clientName: 'Partial client', accountId: 201, accountLabel: 'Snapshot account', market: 'Ru', stack: 'Frontend' },
          { clientId: 202, clientName: 'Failed client', accountId: 202, accountLabel: 'Failed account', market: 'Ru', stack: 'Frontend' }
        ],
        zero: [{ clientId: 301, clientName: 'Empty client', accountId: 301, accountLabel: 'Empty account', market: 'En', stack: 'Go' }],
        failed: [{ clientId: 401, clientName: 'Unavailable client', accountId: 401, accountLabel: 'Unavailable account', market: 'En', stack: 'Go' }],
        sequential: [
          { clientId: 501, clientName: 'Sequential one', accountId: 501, accountLabel: 'First account', market: 'En', stack: 'Go' },
          { clientId: 502, clientName: 'Sequential two', accountId: 502, accountLabel: 'Second account', market: 'En', stack: 'Go' }
        ]
      }
      if (scenario === 'transport') {
        return await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary sender catalog failure.' }) })
      }
      if (scenario === 'slow') {
        delayedCatalogSeen = true
        await wait(600)
      }
      return await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ senders: definitions[scenario] || definitions.fresh }) }).catch(() => {})
    }
    const scenarioDialogs = async (route: any) => {
      const url = new URL(route.request().url())
      const clientId = Number(url.searchParams.get('targetClientId'))
      if (clientId < 100) return await route.continue()
      assert.equal(url.searchParams.get('privateOnly'), 'true', 'admin snapshots must request private-only dialogs')
      activeSnapshotRequests += 1
      maxActiveSnapshotRequests = Math.max(maxActiveSnapshotRequests, activeSnapshotRequests)
      try {
        await wait(25)
        if ([202, 401].includes(clientId)) {
          return await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'telegram_connecting' }) })
        }
        if (clientId === 301) return await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accountId: clientId, dialogs: [] }) })
        const list = url.searchParams.get('list') || 'main'
        const title = clientId === 101 ? 'Stale dialog' : clientId === 102 ? 'Fresh dialog' : 'Snapshot kept'
        return await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          accountId: clientId,
          dialogs: [
            { id: `${clientId}-${list}`, title, chatList: list, isPrivate: true, lastMessageAt: new Date().toISOString() },
            { id: `${clientId}-${list}-group`, title: 'Hidden group dialog', chatList: list, isPrivate: false, lastMessageAt: new Date().toISOString() }
          ]
        }) })
      } finally {
        activeSnapshotRequests -= 1
      }
    }
    const scenarioScan = async (route: any) => {
      scanRequests += 1
      const url = new URL(route.request().url())
      const clientId = Number(url.searchParams.get('targetClientId'))
      activeScanRequests += 1
      maxActiveScanRequests = Math.max(maxActiveScanRequests, activeScanRequests)
      const base = {
        clientId,
        clientName: clientId === 201 ? 'Partial client' : clientId === 202 ? 'Failed client' : `Client ${clientId}`,
        accountId: clientId,
        accountLabel: `Account ${clientId}`,
        discoveredCount: 2,
        matchedCount: 0,
        durationMs: 25
      }
      try {
        await wait(25)
        if (clientId === 201) return await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          rows: [],
          accountResult: {
            ...base,
            outcome: 'partial',
            stage: 'chat_load_archive',
            lists: { main: { complete: true, discovered: 2 }, archive: { complete: false, discovered: 0 } },
            error: { code: 'telegram_dialog_scan_timeout', message: 'Telegram dialog scan exceeded its configured deadline.', stage: 'chat_load_archive' }
          }
        }) })
        if ([202, 401].includes(clientId)) return await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          rows: [],
          accountResult: {
            ...base,
            outcome: 'failed',
            stage: 'authorization',
            lists: { main: { complete: false, discovered: 0 }, archive: { complete: false, discovered: 0 } },
            error: { code: 'telegram_connecting', message: 'The stored Telegram session is still initializing.', stage: 'authorization' }
          }
        }) })
        const empty = clientId === 301
        return await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          rows: empty ? [] : [
            { clientId, clientName: base.clientName, accountId: clientId, accountLabel: base.accountLabel, chatId: `${clientId}-complete`, dialogTitle: clientId === 101 ? 'Stale dialog' : 'Fresh dialog', isPrivate: true, lastMessageAt: new Date().toISOString() },
            { clientId, clientName: base.clientName, accountId: clientId, accountLabel: base.accountLabel, chatId: `${clientId}-complete-group`, dialogTitle: 'Hidden scan group', isPrivate: false, lastMessageAt: new Date().toISOString() }
          ],
          accountResult: {
            ...base,
            outcome: 'complete',
            stage: 'complete',
            matchedCount: empty ? 0 : 1,
            lists: { main: { complete: true, discovered: 1 }, archive: { complete: true, discovered: 1 } }
          }
        }) })
      } finally {
        activeScanRequests -= 1
      }
    }
    const countEagerHistory = async (route: any) => {
      eagerHistoryRequests += 1
      await route.continue()
    }
    await page.route('**/api/admin/telegram/senders', scenarioSenders)
    await page.route('**/api/telegram/dialogs?*', scenarioDialogs)
    await page.route('**/api/admin/telegram/dialogs/scan?*', scenarioScan)
    await page.route('**/api/telegram/messages?*', countEagerHistory)

    scenario = 'slow'
    await page.getByTestId('admin-dialog-days').fill('2')
    await page.getByTestId('admin-dialog-apply').click()
    while (!delayedCatalogSeen) await wait(10)
    scenario = 'fresh'
    await page.getByTestId('admin-dialog-reset').click()
    await page.getByTestId('admin-dialog-account-coverage').getByText(/Accounts loaded: 1\/1.*Full scans: 0\/1/).waitFor()
    await page.getByText('Fresh dialog', { exact: true }).first().waitFor()
    assert.equal(await page.getByText('Hidden group dialog', { exact: true }).count(), 0)
    await page.waitForTimeout(700)
    assert.equal(await page.getByText('Stale dialog', { exact: true }).count(), 0)
    assert.equal(eagerHistoryRequests, 0, 'admin collection must not eagerly load message history')
    assert.equal(scanRequests, 0, 'admin collection must not start exhaustive scans automatically')
    await page.getByTestId('admin-dialog-load-all').click()
    await page.getByTestId('admin-dialog-account-coverage').getByText(/Full scans: 1\/1/).waitFor()
    assert.equal(scanRequests, 1, 'exhaustive scanning must start only after explicit user action')
    assert.equal(await page.getByText('Hidden scan group', { exact: true }).count(), 0)

    scenario = 'partial'
    await page.getByTestId('admin-dialog-apply').click()
    await page.getByTestId('admin-dialogs-partial-error').getByText(/Accounts loaded: 1\/2.*Full scans: 0\/2.*1 failed/).waitFor()
    await page.getByText('Snapshot kept', { exact: true }).first().waitFor()
    assert.equal(scanRequests, 1, 'failed snapshots must not trigger exhaustive scans')
    await page.getByTestId('admin-dialog-load-all').click()
    await page.getByTestId('admin-dialogs-partial-error').getByText(/Accounts loaded: 1\/2.*Full scans: 0\/2.*1 partial.*1 failed/).waitFor()
    await page.getByTestId('admin-dialog-diagnostics').locator('summary').click()
    await page.getByText('chat_load_archive', { exact: false }).waitFor()
    await page.locator('[data-testid^="admin-dialog-retry-"]').first().waitFor()

    scenario = 'transport'
    await page.getByTestId('admin-dialog-apply').click()
    await page.getByTestId('admin-dialogs-error').getByText('Showing the last successful results.', { exact: false }).waitFor()
    await page.getByText('Snapshot kept', { exact: true }).first().waitFor()
    await page.getByTestId('admin-dialog-account-coverage').getByText('stale', { exact: false }).waitFor()

    scenario = 'zero'
    await page.getByTestId('admin-dialog-apply').click()
    await page.getByTestId('admin-dialogs-empty').getByText('All 1 account snapshots loaded; no recent private dialogs matched this period.', { exact: false }).waitFor()

    scenario = 'failed'
    await page.getByTestId('admin-dialog-apply').click()
    await page.getByTestId('admin-dialogs-total-failure').getByText('Private dialog data could not be loaded', { exact: false }).waitFor()
    assert.equal(await page.getByText('no private dialogs matched this period', { exact: false }).count(), 0)

    scenario = 'sequential'
    maxActiveSnapshotRequests = 0
    maxActiveScanRequests = 0
    await page.getByTestId('admin-dialog-apply').click()
    await page.getByTestId('admin-dialog-account-coverage').getByText(/Accounts loaded: 2\/2.*Full scans: 0\/2/).waitFor()
    assert.equal(maxActiveSnapshotRequests, 1, 'account snapshots must be serialized')
    await page.getByTestId('admin-dialog-load-all').click()
    await page.getByTestId('admin-dialog-account-coverage').getByText(/Full scans: 2\/2/).waitFor()
    assert.equal(maxActiveScanRequests, 1, 'explicit exhaustive scans must be serialized')

    await page.unroute('**/api/admin/telegram/senders', scenarioSenders)
    await page.unroute('**/api/telegram/dialogs?*', scenarioDialogs)
    await page.unroute('**/api/admin/telegram/dialogs/scan?*', scenarioScan)
    await page.unroute('**/api/telegram/messages?*', countEagerHistory)
    await page.getByTestId('admin-ai-tailor-open-button').click()
    await page.getByTestId('admin-ai-tailor-dialog').waitFor()
    await page.getByTestId('admin-ai-tailor-dialog').getByText('[Beta] CV AI-tailoring', { exact: false }).waitFor()
    await page.getByTestId('admin-ai-tailor-file-input').setInputFiles(AI_TAILOR_PDF)
    await page.getByTestId('admin-ai-tailor-file-name').getByText('Kira Samsonova React.pdf', { exact: false }).waitFor()
    await page.getByTestId('admin-ai-tailor-job-requirements').fill(AI_TAILOR_JOB_REQUIREMENTS)
    page.once('dialog', (dialog: any) => dialog.accept())
    await page.getByTestId('admin-ai-tailor-submit-button').click()
    await page.getByTestId('admin-ai-tailor-status').getByText('Tailored CV is ready', { exact: false }).waitFor()
    await page.getByTestId('admin-ai-tailor-result-link').getByText('https://tailered-cv.example/mock/Kira%20Samsonova%20React.pdf', { exact: false }).waitFor()
    assert.equal(
      await page.getByTestId('admin-ai-tailor-result-link').getAttribute('href'),
      'https://tailered-cv.example/mock/Kira%20Samsonova%20React.pdf'
    )
    assert.equal(await page.getByTestId('admin-ai-tailor-result-link').getAttribute('target'), '_blank')
    await page.getByTestId('admin-ai-tailor-job-requirements').fill(`${AI_TAILOR_JOB_REQUIREMENTS}\nSecond pass`)
    await page.getByTestId('admin-ai-tailor-always-verify').uncheck()
    assert.equal(await page.getByTestId('admin-ai-tailor-always-verify').isChecked(), false)
    let unexpectedAiTailorDialog = false
    const unexpectedDialogHandler = async (dialog: any) => {
      unexpectedAiTailorDialog = true
      await dialog.dismiss()
    }
    page.once('dialog', unexpectedDialogHandler)
    await page.getByTestId('admin-ai-tailor-submit-button').click()
    await page.getByTestId('admin-ai-tailor-result-link').waitFor()
    await page.waitForTimeout(250)
    page.off('dialog', unexpectedDialogHandler)
    assert.equal(unexpectedAiTailorDialog, false)
    await page.getByTestId('admin-ai-tailor-clear-button').click()
    assert.equal(await page.getByTestId('admin-ai-tailor-file-name').count(), 0)
    assert.equal(await page.getByTestId('admin-ai-tailor-job-requirements').inputValue(), '')
    assert.equal(await page.getByTestId('admin-ai-tailor-result-link').count(), 0)
    assert.equal(await page.getByTestId('admin-ai-tailor-status').count(), 0)
    assert.equal(await page.getByTestId('admin-ai-tailor-always-verify').isChecked(), false)
    await page.keyboard.press('Escape')
    await page.getByTestId('admin-telegram-open-button').click()
    await page.getByTestId('admin-telegram-dialog').waitFor()
    await page.getByTestId('admin-telegram-sender-summary').click()
    await page.getByTestId('admin-telegram-sender-dropdown').waitFor()
    await page.getByTestId('admin-telegram-market-column').getByRole('button', { name: 'Ru' }).click()
    await page.getByTestId('admin-telegram-stack-column').getByRole('button', { name: 'FRONTEND' }).click()
    await page.getByTestId('admin-telegram-sender-search').fill('Kira')
    await page.getByTestId('admin-telegram-account-column').getByRole('button', { name: /Test - Kira Telegram Ru/ }).click()
    await page.getByTestId('admin-telegram-sender-summary').getByText('Test - Kira Telegram Ru', { exact: false }).waitFor()
    assert.equal(await page.getByTestId('admin-telegram-sender-dropdown').count(), 0)
    await page.getByTestId('admin-telegram-recipient').fill('@client_partner')
    await page.getByTestId('admin-telegram-message').fill('Admin Telegram modal e2e')
    const adminFeatureFile = path.join(ARTIFACT_DIR, 'admin-telegram-feature.md')
    fs.writeFileSync(adminFeatureFile, '# Admin Telegram feature\n\nE2E attachment.')
    await page.getByTestId('admin-telegram-file-input').setInputFiles(adminFeatureFile)
    await page.getByTestId('admin-telegram-attachments').getByText('admin-telegram-feature.md', { exact: false }).waitFor()
    page.once('dialog', (dialog: any) => dialog.accept())
    await page.getByTestId('admin-telegram-send-button').click()
    await page.getByTestId('admin-telegram-status').getByText('Message sent', { exact: false }).waitFor()
    await page.getByTestId('admin-telegram-message').fill('Admin Telegram no confirm e2e')
    await page.getByTestId('admin-telegram-always-verify').uncheck()
    assert.equal(await page.getByTestId('admin-telegram-always-verify').isChecked(), false)
    await page.getByTestId('admin-telegram-send-button').click()
    await page.getByTestId('admin-telegram-status').getByText('Message sent', { exact: false }).waitFor()
    await page.keyboard.press('Escape')
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
    if (path.dirname(path.resolve(TDLIB_E2E_ROOT)) === path.resolve(ARTIFACT_DIR)) {
      fs.rmSync(TDLIB_E2E_ROOT, { recursive: true, force: true })
    }
  }
}

async function assertText(page: any, text: string): Promise<void> {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: 10000 })
}

async function dismissRequiredDataDialogIfVisible(page: any): Promise<void> {
  if (await page.getByTestId('required-data-dialog').count()) {
    await page.getByTestId('confirm-required-data-dialog-button').click()
  }
}

runTests()
  .then(() => {
    console.log(`web console e2e tests passed; screenshots written to ${ARTIFACT_DIR}`)
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
