import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'

test('creator completion checklist explains missing saved data and restores proxy confirmation after reopening', { timeout: 45000 }, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const fixture = `import { createApp } from 'vue'
    import Creator from '/src/components/LinkedInCreatorConsole.vue'
    createApp(Creator).mount('#app')`
  const server = await createServer({ configFile: false, root, plugins: [vue(), {
    name: 'creator-checklist-fixture', resolveId: id => id === 'virtual:creator-checklist' ? '\0creator-checklist' : null,
    load: id => id === '\0creator-checklist' ? fixture : null,
    configureServer(server) { server.middlewares.use('/creator-checklist-test', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/creator-checklist-test', '<div id="app"></div><script type="module" src="/@id/virtual:creator-checklist"></script>'))
    }) }
  }], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.OCTO_E2E_BROWSER_CHANNEL || undefined })
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    let task = { id: 12, clientId: 269, version: 1, status: 'не начата', fio: 'Test client', stack: 'JAVA' }
    let intake = { url: 'https://www.linkedin.com/in/example', login: 'https://www.linkedin.com/in/legacy-login', hasPassword: true,
      outlookLogin: 'student.one@custom.example', blockedAccounts: [
        {fullName:'Earlier account',country:'Poland'},
        {fullName:'Archived account',legacyText:'Архивный LinkedIn №11\nСсылка LinkedIn: https://linkedin.com/in/archived'}] }
    const secondTask = { id: 13, clientId: 270, version: 1, status: 'не начата', fio: 'Second client', stack: 'JAVA' }
    let savedResult
    let captures = 0, statusWrites = 0
    let notification = { outcome: 'sent', messageId: 77 }
    let newProxyRequired=false,newProxyReady=false,proxyWrites=0,assignmentPolls=0
    let rejectProxy
    const proxyRejection = new Promise(resolve => { rejectProxy = resolve })
    await page.route('**/api/linkedin-creator/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if(path.endsWith('/profiles/349/proxy')){
        proxyWrites++
        if(request.postDataJSON().login==='same')return route.fulfill({status:409,json:{error:'linkedin_task_proxy_reused'}})
        if(request.postDataJSON().login==='offline'){
          await proxyRejection
          return route.fulfill({status:502,json:{error:'linkedin_task_proxy_check_failed'}})
        }
        task={...task,version:task.version+1,proxySavedAt:undefined};assignmentPolls=2;newProxyReady=false
        return route.fulfill({json:{queued:true,task}})
      }
      if (path.endsWith('/octo/status')) {
        if(assignmentPolls && --assignmentPolls===0){task={...task,version:task.version+1};newProxyReady=true}
        return route.fulfill({ json: {task,
        ...(newProxyRequired?{newProxyRequired,newProxyReady}:{}),
        profiles: [{ id: 349, locale: 'en', title: 'Fixture EN', phase: 'ready', canEditProxy: true,canAcquire:!newProxyRequired||newProxyReady,
          proxy: { configured: true, credentialsLoaded: true, type: 'socks5', host: 'example.test', port: 1080, ...(newProxyRequired&&newProxyReady?{phase:'complete'}:{}) } }],
        requiredLocales: ['en'], onboarding: { phase: 'complete' }
      } }) }
      if (path.endsWith('/capture-proxy')) {
        if(request.postDataJSON().version!==task.version)return route.fulfill({status:409,json:{error:'linkedin_task_stale_version'}})
        captures++
        task = { ...task, version: task.version + 1, proxySavedAt: new Date().toISOString() }
        return route.fulfill({ json: task })
      }
      if (path.endsWith('/status')) {
        statusWrites++
        task = { ...task, status: request.postDataJSON().status }
        return route.fulfill({ json: { ...task, notification } })
      }
      if (path.endsWith('/tasks/12/result')) {
        savedResult = request.postDataJSON()
        intake = { ...intake, url: savedResult.url, login: savedResult.login, hasPassword: true }
        task = { ...task, version: task.version + 1 }
        return route.fulfill({ json: task })
      }
      if (path.endsWith('/tasks/12')) return route.fulfill({ json: { task, intake, client: { id: 269, fio: 'Test client' } } })
      if (path.endsWith('/tasks/13')) return route.fulfill({ json: { task: secondTask,
        intake: { url: '', login: '', hasPassword: false, outlookLogin: 'student.two@gmail.com', blockedAccounts: [] },
        client: { id: 270, fio: 'Second client' } } })
      if (path.endsWith('/tasks')) return route.fulfill({ json: [task, secondTask] })
      throw Error('unexpected_fixture_request')
    })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/creator-checklist-test`)
    const open = page.getByTestId('creation-task-12')
    await open.click()
    const checklist = page.getByRole('region', { name: 'Что нужно для завершения заявки' })
    await checklist.waitFor()
    assert.equal(await page.getByTestId('creator-blocked-account').count(),2)
    await page.getByRole('heading',{name:'Старые заблокированные аккаунты (2)',exact:true}).waitFor()
    await page.getByRole('heading',{name:'Аккаунт 2',exact:true}).waitFor()
    assert.match(await page.getByTestId('creator-blocked-account').nth(1).innerText(),/https:\/\/linkedin.com\/in\/archived/)
    assert.equal(await page.getByLabel('Логин LinkedIn', { exact: true }).inputValue(), 'https://www.linkedin.com/in/legacy-login',
      'loading an existing account must not silently replace its historical login')
    const proxy = checklist.getByTestId('completion-proxy')
    const done = page.getByRole('option', { name: 'сделана экспертом', exact: true })
    assert.equal(await done.evaluate(option => option.disabled), true, await proxy.textContent())
    assert.match(await proxy.textContent(), /Нажмите «Сохранить настройки прокси»/)
    for (const id of ['url', 'login', 'password'])
      assert.match(await checklist.getByTestId(`completion-${id}`).textContent(), /Выполнено/)
    await page.getByRole('button', { name: 'Сохранить настройки прокси', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('select[aria-label="Статус заявки"] option:last-child').disabled)
    assert.match(await proxy.textContent(), /Выполнено/)
    assert.equal(captures, 1)
    await page.reload()
    await open.click()
    await checklist.waitFor()
    assert.equal(await page.getByLabel('Логин LinkedIn', { exact: true }).inputValue(), 'https://www.linkedin.com/in/legacy-login')
    await page.waitForFunction(() => !document.querySelector('select[aria-label="Статус заявки"] option:last-child').disabled)
    assert.match(await proxy.textContent(), /Выполнено/)
    assert.equal(captures, 1, 'reopening must use the saved receipt without requiring another capture')
    await page.getByRole('combobox', { name: 'Статус заявки', exact: true }).selectOption('сделана экспертом')
    await page.getByRole('button', { name: 'Сохранить статус', exact: true }).click()
    await page.getByText('Статус сохранён. Уведомление отправлено в менеджерский Telegram-чат.', { exact: true }).waitFor()
    assert.equal(statusWrites, 1)
    notification = { outcome: 'failed', code: 'telegram_403' }
    await page.getByRole('combobox', { name: 'Статус заявки', exact: true }).selectOption('блок')
    await page.getByRole('button', { name: 'Сохранить статус', exact: true }).click()
    await page.getByText('Статус сохранён. Не удалось отправить уведомление в менеджерский Telegram-чат.', { exact: true }).waitFor()
    assert.equal(task.status, 'блок')
    notification = { outcome: 'uncertain', code: 'transport' }
    await page.getByRole('combobox', { name: 'Статус заявки', exact: true }).selectOption('не начата')
    await page.getByRole('button', { name: 'Сохранить статус', exact: true }).click()
    await page.getByText('Статус сохранён. Подтверждение отправки уведомления в Telegram не получено.', { exact: true }).waitFor()
    assert.equal(task.status, 'не начата')

    task = { ...task, status: 'не начата' }
    intake = { ...intake, url: '', login: '', hasPassword: false }
    await open.click()
    await checklist.waitFor()
    assert.equal(await page.getByLabel('Логин LinkedIn', { exact: true }).inputValue(), 'student.one@custom.example')
    assert.match(await checklist.getByTestId('completion-password').textContent(), /Введите пароль LinkedIn и нажмите «Сохранить данные LinkedIn»/)
    await page.getByLabel('Ссылка LinkedIn', { exact: true }).fill('https://www.linkedin.com/in/unsaved')
    await page.getByLabel('Пароль LinkedIn', { exact: true }).fill('unsaved')
    assert.equal(await done.evaluate(option => option.disabled), true, 'typing without saving must not count as saved account data')
    assert.match(await checklist.getByTestId('completion-url').textContent(), /Не выполнено/)
    assert.equal(statusWrites, 3)
    assert.match(await checklist.getByTestId('completion-login').textContent(), /Не выполнено/,
      'an autofilled email still needs an explicit result save')
    await page.getByRole('button', { name: 'Сохранить данные LinkedIn', exact: true }).click()
    await page.getByText('Данные LinkedIn сохранены.', { exact: true }).waitFor()
    assert.equal(savedResult.url, 'https://www.linkedin.com/in/unsaved')
    assert.equal(savedResult.login, 'student.one@custom.example')
    assert.match(await checklist.getByTestId('completion-login').textContent(), /Выполнено/)
    await page.getByTestId('creation-task-13').click()
    await checklist.waitFor()
    assert.equal(await page.getByLabel('Логин LinkedIn', { exact: true }).inputValue(), 'student.two@gmail.com',
      'the next task must use its own bound mailbox instead of the previous student email')
    assert.equal(await page.getByLabel('Ссылка LinkedIn', { exact: true }).inputValue(), '')
    newProxyRequired=true;task={...task,requiresNewProxy:true};await open.click()
    const capture=page.getByRole('button',{name:'Сохранить настройки прокси',exact:true})
    await checklist.waitFor()
    assert.equal(await capture.isEnabled(),false)
    assert.equal(await page.getByRole('button',{name:'Получить доступ',exact:true}).isEnabled(),false)
    assert.match(await proxy.textContent(),/Введите новые реквизиты/)
    await page.getByLabel('Логин прокси',{exact:true}).fill('same')
    await page.getByLabel('Пароль прокси',{exact:true}).fill('fixture')
    await page.getByRole('button',{name:'Показать пароль прокси',exact:true}).click()
    assert.equal(await page.getByLabel('Пароль прокси',{exact:true}).getAttribute('type'),'text')
    await page.getByRole('button',{name:'Сохранить прокси',exact:true}).click()
    await page.getByText('Для нового LinkedIn нужны новые реквизиты прокси. Сейчас введено прежнее подключение.',{exact:true}).waitFor()
    await page.getByLabel('Логин прокси',{exact:true}).fill('offline')
    await page.getByRole('button',{name:'Сохранить прокси',exact:true}).click()
    const proxyForm=page.getByTestId('octo-proxy-form-349')
    await proxyForm.getByText('Проверяем прокси, это может занять до минуты.',{exact:true}).waitFor()
    assert.equal(await proxyForm.getAttribute('aria-busy'),'true')
    assert.equal(await proxyForm.locator('.pi-spin').count()>0,true)
    rejectProxy()
    const failure=proxyForm.getByRole('alert')
    await failure.filter({hasText:'Прокси не прошёл проверку подключения.'}).waitFor()
    await page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/octo/status'))
    assert.match(await failure.innerText(),/Проверь адрес, порт, логин и пароль/,'failure survives the next status poll')
    assert.equal(await page.getByLabel('Логин прокси',{exact:true}).inputValue(),'offline','failed submission retains the entered fields')
    await page.getByLabel('Логин прокси',{exact:true}).fill('new')
    await page.getByRole('button',{name:'Сохранить прокси',exact:true}).click()
    await page.waitForFunction(()=>!document.querySelector('[data-testid="octo-profile-349"] button').disabled)
    await page.getByText('Прокси сохранён',{exact:true}).waitFor()
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Сохранить настройки прокси').disabled)
    assert.equal(await failure.count(),0)
    assert.equal(await page.getByText('Открывать профиль Octo для этого не требуется.',{exact:false}).count(),1)
    await capture.click()
    await page.getByText('Настройки прокси сохранены.',{exact:true}).waitFor()
    assert.equal(captures,2);assert.equal(proxyWrites,3)
  } finally { await browser?.close(); await server.close() }
})
