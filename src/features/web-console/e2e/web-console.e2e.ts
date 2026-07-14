const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '../../../..')
const ARTIFACT_DIR = path.join(ROOT, 'tmp', 'web-console-e2e')
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

    await page.getByTestId('email-input').fill('unicornveryevil@gmail.com')
    await page.locator('input[type="password"]').fill('101010')
    await page.getByTestId('login-button').click()
    await page.getByTestId('admin-dashboard').waitFor()
    assert.equal(await page.getByTestId('telegram-card').count(), 0)
    assert.equal(await page.getByTestId('own-proxy-panel').count(), 0)
    assert.equal(await page.getByTestId('open-dolphin-admin-button').count(), 0)
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
