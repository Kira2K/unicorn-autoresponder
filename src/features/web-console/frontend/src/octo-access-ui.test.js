import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

test('Octo access: failed request survives polling, retry displays credentials, expiry hides them', { timeout: 45000 }, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const fixture = `import { createApp, h } from 'vue'
    import Access from '/src/components/OctoAccessCard.vue'
    createApp({ render: () => h(Access, { clientId: 261 }) }).mount('#app')`
  const server = await createServer({ configFile: false, root, plugins: [vue(), {
    name: 'octo-access-fixture', resolveId: id => id === 'virtual:octo-access' ? '\0octo-access' : null,
    load: id => id === '\0octo-access' ? fixture : null,
    configureServer(server) { server.middlewares.use('/octo-access-test', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/octo-access-test', '<div id="app"></div><script type="module" src="/@id/virtual:octo-access"></script>'))
    }) }
  }], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.OCTO_E2E_BROWSER_CHANNEL || undefined })
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    let polls = 0, allowGrant = false, grantId, expiresAt, grantPhase = 'granted'
    const requests = []
    await page.route('**/api/octo/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (path === '/api/octo/profiles/status') {
        polls++
        return route.fulfill({ json: { profiles: [
          { id: 331, title: 'OctoGuide fixture Ru', locale: 'ru', phase: 'ready', grantId },
          { id: 332, title: 'OctoGuide fixture En', locale: 'en', phase: 'ready' }
        ], requiredLocales: ['ru', 'en'], onboarding: { phase: 'complete' } } })
      }
      if (path === '/api/octo/grants' && request.method() === 'POST') {
        requests.push(request.postDataJSON())
        if (!allowGrant) return route.fulfill({ status: 503, json: { error: 'octo_listener_unavailable' } })
        grantId = 'fixture-grant'
        return route.fulfill({ status: 202, json: { id: grantId, phase: 'preparing' } })
      }
      if (path === '/api/octo/grants/fixture-grant') {
        expiresAt ??= Date.now() + 3500
        return route.fulfill({ json: { id: grantId, profileId: 331, phase: grantPhase, expiresAt,
          ...(grantPhase === 'awaiting_close' ? { error: 'octo_bridge_waiting' } : {}),
          alias: 'Fixture only', password: '00123', guest: { email: 'guest@example.test', password: 'fixture-only' } } })
      }
      throw Error('unexpected_fixture_request')
    })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/octo-access-test`)
    const profile = page.getByTestId('octo-profile-331')
    const button = profile.getByRole('button', { name: 'Получить доступ', exact: true })
    await button.click()
    await page.getByText('Не удалось запросить доступ.', { exact: false }).waitFor()
    const before = polls
    await page.waitForResponse(response => response.url().endsWith('/api/octo/profiles/status') && polls > before)
    assert.equal(await page.getByText('Не удалось запросить доступ.', { exact: false }).isVisible(), true,
      'a successful status poll must not erase a failed access request')
    const error = profile.getByRole('alert')
    assert.match(await error.textContent(), /Обратись в поддержку/)
    assert.equal(await error.getByRole('link', { name: 'Поддержка' }).getAttribute('href'), 'https://t.me/veu_support_bot')
    assert.equal(await page.getByTestId('octo-profile-332').getByRole('alert').count(), 0)
    allowGrant = true
    await button.click()
    await profile.getByText('Подготавливаем доступ…', { exact: true }).waitFor()
    assert.equal(await profile.getByRole('alert').count(), 0)
    const password = profile.getByRole('textbox', { name: 'Пароль к профилям (пароли идентичны для всех твоих профилей)', exact: true })
    await password.waitFor()
    assert.equal(await password.inputValue(), '00123')
    assert.equal(await profile.getByRole('textbox', { name: 'Почта', exact: true }).inputValue(), 'guest@example.test')
    await password.waitFor({ state: 'detached' })
    assert.equal(await profile.getByRole('textbox', { name: 'Почта', exact: true }).count(), 0)
    grantPhase = 'awaiting_close'
    await profile.getByText('Браузер закрыт. Завершаем доступ…', { exact: true }).waitFor()
    assert.equal(await profile.getByRole('textbox', { name: 'Почта', exact: true }).count(), 0)
    assert.deepEqual(requests, [{ profileId: 331 }, { profileId: 331 }])
  } finally { await browser?.close(); await server.close() }
})

test('proxy draft survives tab hiding; password toggles without submitting; client change and denied access clear it', { timeout: 45000 }, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const fixture = `import { createApp, h, ref } from 'vue'
    import Access from '/src/components/OctoAccessCard.vue'
    const clientId = ref(261)
    window.changeFixtureClient = () => { clientId.value = 262 }
    createApp({ render: () => h(Access, { clientId: clientId.value, setupEnabled: false, proxyExpanded: true }) }).mount('#app')`
  const server = await createServer({ configFile: false, root, plugins: [vue(), {
    name: 'octo-proxy-fixture', resolveId: id => id === 'virtual:octo-proxy' ? '\0octo-proxy' : null,
    load: id => id === '\0octo-proxy' ? fixture : null,
    configureServer(server) { server.middlewares.use('/octo-proxy-test', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/octo-proxy-test', '<div id="app"></div><script type="module" src="/@id/virtual:octo-proxy"></script>'))
    }) }
  }], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.OCTO_E2E_BROWSER_CHANNEL || undefined })
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    let denied = false, writes = 0, otherClient = false, credentialReads = 0
    await page.route('**/api/octo/**', async route => {
      if (route.request().method() !== 'GET') { writes++; throw Error('fixture must not write') }
      if (denied) return route.fulfill({ status: 403, json: { error: 'forbidden' } })
      const credentials = new URL(route.request().url()).searchParams.get('proxyCredentials') === '1'
      if (credentials) credentialReads++
      return route.fulfill({ json: { profiles: [
        { id: 332, title: 'Proxy fixture En', locale: 'en', phase: 'ready', canEditProxy: true,
          proxy: { configured: true, type: 'socks5', host: 'gateway.example.test', port: 1080,
            ...(credentials ? { credentialsLoaded: true, login: otherClient ? '' : 'saved-proxy-user', password: otherClient ? '' : 'saved-proxy-password' } : {}) } }
      ], requiredLocales: ['en'], onboarding: { phase: 'complete' } } })
    })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/octo-proxy-test`)
    const form = page.getByTestId('octo-proxy-form-332')
    const login = form.getByLabel('Логин прокси', { exact: true })
    const password = form.getByLabel('Пароль прокси', { exact: true })
    await login.waitFor()
    assert.equal(await login.inputValue(), 'saved-proxy-user')
    assert.equal(await password.inputValue(), 'saved-proxy-password')
    await page.reload()
    await login.waitFor()
    assert.equal(await password.inputValue(), 'saved-proxy-password', 'reload must retrieve saved credentials again')
    const readsAfterReload = credentialReads
    await page.waitForResponse(r => new URL(r.url()).pathname === '/api/octo/profiles/status' && !new URL(r.url()).search)
    assert.equal(credentialReads, readsAfterReload, 'ordinary polling must not reread cloud credentials')
    assert.equal(await password.inputValue(), 'saved-proxy-password')
    await login.fill('unsaved-proxy-user')
    await password.fill('unsaved-proxy-password')
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    assert.equal(await form.count(), 1, 'hiding the tab must not remove the proxy form')
    const resumed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/octo/profiles/status')
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await resumed
    assert.equal(await login.inputValue(), 'unsaved-proxy-user')
    assert.equal(await password.inputValue(), 'unsaved-proxy-password')
    assert.equal(await password.getAttribute('type'), 'password')
    await form.getByRole('button', { name: 'Показать пароль прокси', exact: true }).click()
    assert.equal(await password.getAttribute('type'), 'text')
    assert.equal(await password.inputValue(), 'unsaved-proxy-password')
    await form.getByRole('button', { name: 'Скрыть пароль прокси', exact: true }).click()
    assert.equal(await password.getAttribute('type'), 'password')
    assert.equal(writes, 0, 'password visibility must not submit the form')
    otherClient = true
    const switched = page.waitForResponse(r => new URL(r.url()).pathname === '/api/octo/profiles/status')
    await page.evaluate(() => window.changeFixtureClient())
    await switched
    await form.waitFor()
    assert.equal(await login.inputValue(), '', 'a different client must not inherit the draft')
    assert.equal(await password.inputValue(), '')
    await login.fill('must-clear-on-denial')
    await password.fill('must-clear-on-denial')
    denied = true
    await form.waitFor({ state: 'detached' })
    denied = false
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await form.waitFor()
    assert.equal(await login.inputValue(), '')
    assert.equal(await password.inputValue(), '')
    assert.equal(writes, 0)
  } finally { await browser?.close(); await server.close() }
})
