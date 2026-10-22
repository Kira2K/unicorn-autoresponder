import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

test('Octo setup UI: welcome dismissal, Dolphin warning, key clearing, hierarchy and explicit low-score continuation', { timeout: 60000 }, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const fixture = `
    import { createApp, h, reactive } from 'vue'
    import PrimeVue from 'primevue/config'
    import Dialog from 'primevue/dialog'
    import Button from 'primevue/button'
    import Onboarding from '/src/components/OctoOnboarding.vue'
    import Welcome from '/src/components/BrowserWelcomeDialog.vue'
    const state = reactive({ clientId: 17, welcome: true, status: { profiles: [], requiredLocales: ['Ru', 'En'], onboarding: { phase: 'idle', hasNodeMavenKey: false, dolphinProfiles: [{ id: 9, locale: 'En', hasProxy: true }] } } })
    window.fixtureState = state
    window.queued = 0
    createApp({ render: () => h('main', [state.welcome ? h(Welcome, { clientId: state.clientId }) : null, h(Onboarding, { status: state.status, onQueued: () => { window.queued++; state.status.onboarding.phase = 'queued' } })]) })
      .use(PrimeVue).component('Dialog', Dialog).component('Button', Button).mount('#app')
  `
  const server = await createServer({ configFile: false, root, plugins: [vue(), {
    name: 'octo-test-fixture', resolveId: id => id === 'virtual:octo-test' ? '\0octo-test' : null,
    load: id => id === '\0octo-test' ? fixture : null,
    configureServer(server) { server.middlewares.use('/octo-test', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/octo-test', '<div id="app"></div><script type="module" src="/@id/virtual:octo-test"></script>'))
    }) }
  }], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  let browser
  try {
    await server.listen()
    const address = server.httpServer.address()
    browser = await chromium.launch({ channel: process.env.OCTO_E2E_BROWSER_CHANNEL || undefined })
    const page = await browser.newPage()
    page.setDefaultTimeout(8000)
    const calls = []
    let citiesFail = true
    let releaseKeySave
    const keySaveGate = new Promise(resolve => { releaseKeySave = resolve })
    await page.route('**/api/octo/**', async route => {
      const url = new URL(route.request().url()), body = route.request().postDataJSON()
      calls.push({ path: url.pathname, query: url.searchParams.toString(), method: route.request().method(), body })
      if (url.pathname === '/api/octo/nodemaven-key' && body?.key === 'replacement-key') await keySaveGate
      if (url.pathname === '/api/octo/locations') {
        const level = url.searchParams.get('level')
        if (level === 'cities' && citiesFail) { await route.fulfill({ status: 502, json: { error: 'offline' } }); return }
        const items = level === 'countries' ? [{ code: 'US', name: 'США' }] : level === 'regions' ? [{ code: 'CA', name: 'Калифорния' }] : [{ code: 'SF', name: 'Сан-Франциско' }]
        await route.fulfill({ json: { items } }); return
      }
      await route.fulfill({ status: url.pathname.endsWith('nodemaven-key') ? 200 : 202, json: { saved: true } })
    })
    await page.goto(`http://127.0.0.1:${address.port}/octo-test`)
    await page.getByTestId('octo-welcome').waitFor()
    await page.getByRole('button', { name: 'Понятно, продолжить' }).click()
    assert.equal(await page.evaluate(() => localStorage.getItem('webConsole.octoWelcome.v1.17')), 'closed')
    await page.reload()
    await page.getByTestId('octo-onboarding').waitFor()
    assert.equal(await page.getByTestId('octo-welcome').count(), 0)
    await page.getByRole('button', { name: 'Сгенерировать NodeMaven прокси или протестировать свой' }).click()
    await page.getByRole('dialog', { name: 'У тебя уже есть профиль в Dolphin' }).waitFor()
    assert.equal(calls.length, 0, 'Dolphin warning must precede any setup side effect')
    await page.getByRole('button', { name: 'Продолжить в любом случае' }).click()
    await page.getByLabel('Ключ NodeMaven', { exact: true }).fill('test-key')
    await page.getByRole('button', { name: 'Сохранить ключ' }).click()
    await page.getByText('Ключ NodeMaven сохранён.', { exact: false }).waitFor()
    assert.equal(await page.getByLabel('Ключ NodeMaven', { exact: true }).count(), 0, 'saved key must leave the input')
    await page.getByLabel('Страна', { exact: true }).selectOption('US')
    await page.getByLabel('Регион', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Проверить прокси и создать профили' }).isEnabled(), false)
    await page.getByLabel('Регион', { exact: true }).selectOption('CA')
    await page.getByText('Не удалось загрузить список. Повторите попытку.').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Проверить прокси и создать профили' }).isEnabled(), false)
    citiesFail = false
    await page.getByRole('button', { name: 'Повторить', exact: true }).click()
    await page.getByLabel('Город', { exact: true }).selectOption('SF')
    // Editing an existing key must lock the old catalogue until the replacement
    // has been saved and the fresh country request completes.
    await page.getByRole('button', { name: 'Изменить ключ', exact: true }).click()
    for (const label of ['Страна', 'Регион', 'Город']) assert.equal(await page.getByLabel(label, { exact: true }).isDisabled(), true)
    await page.getByLabel('Ключ NodeMaven', { exact: true }).fill('replacement-key')
    const keyRequest = page.waitForRequest(request => request.url().endsWith('/api/octo/nodemaven-key') && request.postDataJSON()?.key === 'replacement-key')
    await page.getByRole('button', { name: 'Сохранить ключ' }).click()
    await keyRequest
    for (const label of ['Страна', 'Регион', 'Город']) assert.equal(await page.getByLabel(label, { exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Проверить прокси и создать профили' }).isEnabled(), false)
    releaseKeySave()
    await page.getByLabel('Страна', { exact: true }).selectOption('US')
    await page.getByLabel('Регион', { exact: true }).selectOption('CA')
    await page.getByLabel('Город', { exact: true }).selectOption('SF')
    await page.getByRole('button', { name: 'Проверить прокси и создать профили' }).click()
    await page.waitForFunction(() => window.queued === 1)
    await page.getByText('Проверка может занять до 4 минут.', { exact: true }).waitFor()
    assert.deepEqual(calls.find(call => call.path === '/api/octo/onboarding').body, { source: 'nodemaven', confirmDolphin: true, location: { country: 'US', region: 'CA', city: 'SF' } })
    assert.equal(calls.some(call => call.path.includes('grants')), false, 'setup must not request access automatically')
    await page.evaluate(() => { window.fixtureState.status.onboarding = { phase: 'awaiting_confirmation', id: 'check-1', source: 'own', score: 44 } })
    await page.getByText('44/100', { exact: true }).waitFor()
    assert.equal(calls.some(call => call.path.endsWith('/continue')), false)
    await page.getByRole('button', { name: 'Продолжить в любом случае' }).click()
    await page.waitForFunction(() => window.queued === 2)
    assert.deepEqual(calls.find(call => call.path.endsWith('/continue')).body, { acceptLowScore: true })
    await page.evaluate(() => { window.fixtureState.status = { profiles: [], requiredLocales: ['En'], onboarding: { phase: 'idle', dolphinProfiles: [] } } })
    await page.getByRole('button', { name: 'Сгенерировать NodeMaven прокси или протестировать свой' }).click()
    await page.getByRole('radio', { name: 'Проверить свой SOCKS5 прокси' }).check()
    await page.getByLabel('Строка SOCKS5 прокси', { exact: true }).fill('socks5://test-user:test-password@proxy.example:1080')
    await page.getByRole('button', { name: 'Проверить прокси и создать профили' }).click()
    await page.waitForFunction(() => window.queued === 3)
    assert.deepEqual(calls.filter(call => call.path === '/api/octo/onboarding').at(-1).body, { source: 'own', confirmDolphin: false, proxy: 'socks5://test-user:test-password@proxy.example:1080' })
    await page.evaluate(() => { window.fixtureState.status = { profiles: [], requiredLocales: ['En'], onboarding: { phase: 'idle', dolphinProfiles: [{ id: 9, locale: 'En', hasProxy: true }] } } })
    await page.getByRole('button', { name: 'Сгенерировать NodeMaven прокси или протестировать свой' }).click()
    await page.getByRole('button', { name: 'Продолжить в любом случае' }).click()
    await page.getByRole('radio', { name: 'Использовать прокси из Dolphin' }).check()
    await page.getByRole('button', { name: 'Проверить прокси и создать профили' }).click()
    await page.waitForFunction(() => window.queued === 4)
    assert.deepEqual(calls.filter(call => call.path === '/api/octo/onboarding').at(-1).body, { source: 'dolphin', confirmDolphin: true, profileId: 9 })
    await page.evaluate(() => { window.fixtureState.status = { profiles: [], requiredLocales: ['Ru'], onboarding: { phase: 'idle', dolphinProfiles: [] } } })
    await page.getByRole('button', { name: 'Создать профили', exact: true }).click()
    await page.waitForFunction(() => window.queued === 5)
    assert.deepEqual(calls.filter(call => call.path === '/api/octo/onboarding').at(-1).body, { source: 'none', confirmDolphin: false })
    assert.equal(await page.getByRole('dialog').count(), 0, 'Ru-only setup skips proxy wizard')
    await page.evaluate(() => { window.fixtureState.status.onboarding = { phase: 'blocked', source: 'own', id: 'failed', score: 30, error: 'proxy_unreachable' } })
    await page.getByText('Не удалось завершить проверку или настройку.', { exact: false }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Продолжить в любом случае' }).count(), 0, 'unreachable proxy cannot be continued')
    await page.evaluate(() => { window.fixtureState.status = { profiles: [], requiredLocales: ['En'], onboarding: {
      phase: 'idle', dolphinProfiles: [], developmentHelp: {
        message: 'Сервис проверки прокси недоступен. Обратитесь в поддержку.',
        repositoryUrl: 'https://github.com/Kira2K/unicorn-proxy-checker'
      }
    } } })
    const help = page.getByTestId('octo-checker-local-help')
    await help.waitFor()
    assert.match(await help.textContent(), /Сервис проверки прокси недоступен\. Обратитесь в поддержку\./)
    assert.equal(await help.getByRole('link', { name: 'Поддержка', exact: true }).getAttribute('href'), 'https://t.me/veu_support_bot')
    assert.equal(await help.locator('a[href*="github.com"], a[download]').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Сгенерировать NodeMaven прокси или протестировать свой' }).isDisabled(), true)
    await page.evaluate(() => { delete window.fixtureState.status.onboarding.developmentHelp })
    await help.waitFor({ state: 'detached' })
    assert.equal(await page.getByRole('button', { name: 'Сгенерировать NodeMaven прокси или протестировать свой' }).isEnabled(), true)
  } finally { await browser?.close(); await server.close() }
})
