import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {mkdir} from 'node:fs/promises'
import { parseIntake } from '../../../linkedin-automation/console-intake/contracts.mts'

test('registration keeps current edits and prior access, locks completed data, and prevents repeat applications', {timeout:90000}, async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url))
  const fixture=`import {createApp,h} from 'vue';import PrimeVue from 'primevue/config';
    import Workflow from '/src/components/LinkedInOctoWorkflow.vue';
    const query=new URLSearchParams(location.search);
    createApp({render:()=>h(Workflow,{client:{id:7,market:query.get('market'),firstName:'Николай',lastName:'Соколов',realLocation:'Tbilisi'},hasDolphin:query.get('dolphin')==='1'})}).use(PrimeVue).mount('#app')`
  const server=await createServer({configFile:false,root,cacheDir:'node_modules/.vite-linkedin-recovery',plugins:[vue(),{
    name:'recovery-fixture',resolveId:id=>id==='virtual:recovery'?'\0recovery':null,load:id=>id==='\0recovery'?fixture:null,
    configureServer(s){s.middlewares.use('/recovery-test',async(_req,res)=>{
      res.setHeader('Content-Type','text/html')
      res.end(await s.transformIndexHtml('/recovery-test','<div id="app"></div><script type="module" src="/@id/virtual:recovery"></script>'))
    })}
  }],server:{host:'127.0.0.1',port:0},logLevel:'error'})
  let browser
  try{
    await server.listen();browser=await chromium.launch()
    const page=await browser.newPage();page.setDefaultTimeout(10000)
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    let status='сделана экспертом',writes=0,allowSave=false,fresh=false,prior=false
    let newTask=false,missingLatin=false,setupPhase='complete',isBanned=false,banReports=0,serverMismatch=false
    const submissions=[]
    await page.route('**/api/**',async route=>{
      if(new URL(route.request().url()).pathname==='/api/client/linkedin-intake/ban'){
        assert.equal(route.request().postDataJSON().linkedinAccountId,11);banReports++;isBanned=true
        return route.fulfill({json:{reported:true,isBanned:true,linkedinAccountId:11}})
      }
      if(route.request().method()!=='GET'){
        if(serverMismatch)return route.fulfill({status:400,json:{error:'linkedin_intake_outlook_name_mismatch'}})
        writes++;assert.ok(allowSave,'opening/cancelling a replacement must not create an application')
        submissions.push(route.request().postDataJSON())
        const created=!!route.request().postDataJSON().replacesLinkedInAccountId
        if(created){newTask=true;status='не начата';prior=true}
        return route.fulfill({json:{saved:true,task:{id:newTask?15:14,status,created}}})
      }
      if(fresh&&new URL(route.request().url()).pathname==='/api/client/linkedin-intake')return route.fulfill({json:{
        hasLinkedIn:false,hasPassword:false,hasOutlookPassword:false,url:'',login:'',outlookLogin:'',
        firstName:'',lastName:'',realLocation:'',blockedAccounts:[]
      }})
      if(new URL(route.request().url()).pathname==='/api/client/linkedin-intake')return route.fulfill({json:{
        task:status?{id:newTask?15:14,status}:undefined,linkedinAccountId:11,hasLinkedIn:!newTask||status==='сделана экспертом',isBanned,
        hadLinkedInBeforeTask:prior,previousOctoProfileIds:prior?[1]:[],
        registrationPending:!!status&&status!=='сделана экспертом',
        editLocked:['сделана экспертом'].includes(status),completionConfirmed:status==='сделана экспертом',
        url:'https://linkedin.com/in/fixture',login:'old@example.test',hasPassword:true,outlookLogin:'alex.smith.old@outlook.com',hasOutlookPassword:true,
        firstName:missingLatin?'Николай':'Alex',lastName:missingLatin?'Соколов':'Smith',realLocation:'Tbilisi',blockedAccounts:[{fullName:'Earlier account',country:'Georgia',company:'Previous Company',position:'Developer',blockedAt:'2026-10-01'}]
      }})
      return route.fulfill({json:{profiles:[{id:1,locale:'en',title:'Existing EN',phase:'ready',canAcquire:true,canEditProxy:true,proxy:{configured:true,type:'socks5',host:'proxy.example.test',port:1080,credentialsLoaded:true}},
        {id:2,locale:'en',title:'New EN',phase:'ready',canAcquire:false,canEditProxy:true,proxy:{configured:true}}],requiredLocales:['en'],onboarding:{phase:setupPhase}}})
    })
    const visit=async(dolphin,market,expectBan=true)=>{
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/recovery-test?dolphin=${dolphin?1:0}&market=${market}`)
      if(expectBan)await page.getByTestId('linkedin-report-ban').waitFor().catch(error=>{throw new Error(JSON.stringify({errors,error:error.message}))})
      else if(status==='сделана экспертом')await page.getByText('Заявка обработана экспертом. Для изменения данных обратись в поддержку.',{exact:true}).waitFor()
      else await page.getByTestId('linkedin-new-form').waitFor()
      assert.equal(await page.getByRole('button',{name:'Меня забанили',exact:true}).count(),expectBan?1:0)
    }
    const replace=async()=>{
      await page.getByTestId('linkedin-report-ban').click()
      const dialog=page.getByRole('dialog',{name:'Попробуй восстановить LinkedIn',exact:true});await dialog.waitFor()
      assert.equal(await dialog.getByRole('link').getAttribute('href'),'https://t.me/+Dum9NCHQjnIyYTMy')
      await dialog.getByRole('button',{name:'Прошла неделя — подать заявку',exact:true}).click()
    }
    for(const pending of ['не начата','блок']){
      status=pending;await visit(false,'En',false)
      await page.getByTestId('linkedin-registration-pending').waitFor()
      assert.equal(await page.locator('.scenario-buttons').count(),0)
      assert.equal(await page.getByTestId('linkedin-existing-form').count(),0,'an expert draft does not switch the active application to existing-account mode')
      assert.equal(await page.getByRole('button',{name:'Сохранить изменения',exact:true}).isEnabled(),true)
      assert.equal(await page.getByRole('button',{name:'Получить доступ',exact:true}).count(),0,'first registration never reveals freshly prepared profiles')
    }
    status='сделана экспертом'
    await page.getByTestId('octo-profile-1').getByRole('button',{name:'Получить доступ',exact:true}).waitFor()
    await page.getByTestId('linkedin-report-ban').waitFor()
    assert.equal(await page.getByTestId('linkedin-existing-form').count(),0)
    assert.equal(await page.locator('.octo-proxy-form').count(),0)
    // Polling locks and unlocks the same application without replacing an unsaved draft.
    prior=true;newTask=true;status='блок';setupPhase='provisioning'
    await page.getByRole('button',{name:'Сохранить изменения',exact:true}).waitFor()
    const outlookDetails=page.getByTestId('linkedin-outlook-details')
    const blockedDetails=page.getByTestId('linkedin-blocked-details')
    assert.equal(await outlookDetails.locator('summary').count(),1,'only the instructions remain collapsible')
    assert.equal(await blockedDetails.locator('summary').count(),0)
    assert.equal(await blockedDetails.getByLabel('Какие имя и фамилия стояли?',{exact:true}).inputValue(),'Earlier account')
    await page.getByTestId('octo-profile-1').waitFor()
    assert.equal(await page.getByTestId('octo-profile-1').getByRole('button',{name:'Получить доступ',exact:true}).isEnabled(),true,'a ready old profile stays usable while a new one is provisioning')
    setupPhase='complete'
    assert.equal(await page.getByTestId('octo-profile-2').count(),0,'new profiles are filtered from previous access')
    assert.equal(await page.locator('.octo-proxy-form').count(),0)
    await page.getByLabel('Город и страна проживания',{exact:true}).fill('Unsaved draft')
    status='не начата'
    await page.waitForTimeout(5200)
    assert.equal(await page.getByLabel('Город и страна проживания',{exact:true}).inputValue(),'Unsaved draft')
    await page.getByRole('button',{name:'Сохранить изменения',exact:true}).waitFor()
    allowSave=true
    await page.getByLabel('Дата и время регистрации Outlook-почты',{exact:true}).fill('2026-10-25');await page.getByLabel('Часы регистрации Outlook-почты',{exact:true}).selectOption('10');await page.getByLabel('Минуты регистрации Outlook-почты',{exact:true}).selectOption('30')
    const outlook=page.getByLabel('Логин от новой почты Outlook',{exact:true})
    const latinName=page.getByLabel('Имя и Фамилия латиницей (как в документах)',{exact:true})
    const nameError=page.getByText('В адресе до @ должны присутствовать имя и фамилия из полей ниже — целиком, в любом порядке. Для составных имени и фамилии достаточно одной части каждого.',{exact:true})
    assert.equal(await page.getByTestId('outlook-instructions').locator('strong').textContent(),'имя.фамилия латиницей')
    await outlook.fill('legacy@outlook.com');await outlook.blur();await nameError.waitFor()
    await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click()
    assert.equal(writes,0,'unchanged legacy Outlook must meet the rule on every save')
    assert.equal(await outlook.evaluate(input=>document.activeElement===input),true)
    await outlook.fill('SMITHalex99@outlook.com');await nameError.waitFor({state:'hidden'})
    await latinName.fill('Alexandre Smith');await nameError.waitFor();await latinName.fill('Alex Smith');await nameError.waitFor({state:'hidden'})
    await outlook.fill('a.l.e.x.smith@outlook.com');await nameError.waitFor()
    await latinName.fill('Anna-Maria Van der Berg');await outlook.fill('maria.berg@outlook.com');await nameError.waitFor({state:'hidden'})
    await latinName.fill('Ivan Ivanov');await outlook.fill('ivanov@outlook.com');await nameError.waitFor()
    await outlook.fill('ivanovivan@outlook.com');await nameError.waitFor({state:'hidden'})
    await latinName.fill('Alex Smith');await outlook.fill('alex.smith@outlook.com');await nameError.waitFor({state:'hidden'})
    serverMismatch=true
    await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await nameError.waitFor()
    assert.equal(writes,0,'a backend validation error does not become a successful save')
    assert.equal(await page.getByLabel('Город и страна проживания',{exact:true}).inputValue(),'Unsaved draft')
    serverMismatch=false;await outlook.fill('alex.smith.99@outlook.com');await nameError.waitFor({state:'hidden'})
    await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click()
    await page.getByText('Заявка обновлена',{exact:true}).waitFor()
    assert.equal(await page.getByRole('dialog').count(),0,'editing an existing task does not show a new-registration success dialog')
    assert.equal(submissions[0].scenario,'new');assert.equal(submissions[0].replacesLinkedInAccountId,undefined)
    assert.equal(writes,1)
    writes=0;submissions.length=0;allowSave=false;newTask=false;status='сделана экспертом'
    await page.getByTestId('linkedin-report-ban').waitFor()
    assert.equal(await page.getByTestId('linkedin-new-form').count(),0)
    for(const [dolphin,market] of [[false,'En'],[true,'En'],[true,'Ru']]){
      if(dolphin)status=''
      await visit(dolphin,market)
      await replace()
      const form=page.getByTestId('linkedin-new-form');await form.waitFor()
      assert.equal(await form.getByLabel('Логин от новой почты Outlook',{exact:true}).inputValue(),'')
      assert.equal(await form.getByLabel('Пароль от новой почты Outlook',{exact:true}).getAttribute('required'),'')
      assert.equal(await form.getByLabel('Имя и Фамилия латиницей (как в документах)',{exact:true}).inputValue(),'Alex Smith')
      assert.equal(await form.getByLabel('Город и страна проживания',{exact:true}).inputValue(),'Tbilisi','saved intake location is preserved')
      assert.equal(await form.locator('.blocked-account').count(),1)
      assert.equal(await page.getByRole('button',{name:'Меня забанили',exact:true}).count(),0)
      await page.getByRole('button',{name:'Отмена',exact:true}).click()
      await page.getByTestId('linkedin-report-ban').waitFor()
      assert.equal(await page.getByTestId('linkedin-new-form').count(),0)
    }
    assert.equal(writes,0)
    status='сделана экспертом';await visit(false,'En')
    await replace()
    const form=page.getByTestId('linkedin-new-form')
    const email=form.getByLabel('Логин от новой почты Outlook',{exact:true})
    await email.fill('test@example.invalid')
    await form.getByLabel('Дата и время регистрации Outlook-почты',{exact:true}).fill('2026-10-25');await page.getByLabel('Часы регистрации Outlook-почты',{exact:true}).selectOption('10');await page.getByLabel('Минуты регистрации Outlook-почты',{exact:true}).selectOption('30')
    await form.getByRole('button',{name:'Сохранить и подготовить Octo',exact:true}).click()
    const summary=form.getByTestId('linkedin-validation-error')
    await summary.waitFor()
    assert.match(await summary.innerText(),/Пароль от новой почты Outlook/)
    assert.equal(writes,0,'native required-field validation also explains why nothing was submitted')
    await form.getByLabel('Пароль от новой почты Outlook',{exact:true}).fill('fixture-password')
    await form.getByRole('button',{name:'Сохранить и подготовить Octo',exact:true}).click()
    await summary.waitFor()
    assert.match(await summary.innerText(),/@outlook\.com/)
    assert.equal(await summary.getAttribute('role'),'alert')
    assert.equal(await email.evaluate(input=>document.activeElement===input),true)
    assert.equal(await form.getByTestId('linkedin-outlook-details').isVisible(),true,'invalid fields remain visible without an outer accordion')
    assert.equal(await form.getByLabel('Пароль от новой почты Outlook',{exact:true}).inputValue(),'fixture-password','collapsing sections preserves the draft')
    assert.equal(writes,0,'invalid Outlook must not send a save request')
    await email.fill('alex.smith.replacement@outlook.com')
    assert.equal(await summary.count(),0,'correcting the email clears the stale error')
    allowSave=true
    await form.getByRole('button',{name:'Сохранить и подготовить Octo',exact:true}).click()
    await page.getByRole('dialog').waitFor()
    assert.equal(writes,1)
    assert.equal(submissions[0].replacesLinkedInAccountId,11)
    assert.equal(submissions[0].outlookLogin,'alex.smith.replacement@outlook.com')
    assert.equal(await page.getByRole('dialog').getByText('Пока ждёшь, пожалуйста, не заходи в профиль Octo: это может помешать регистрации.',{exact:true}).count(),1)
    newTask=false;status='сделана экспертом';missingLatin=true
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/recovery-test?market=En`)
    await replace()
    assert.equal(await page.getByLabel('Имя и Фамилия латиницей (как в документах)',{exact:true}).inputValue(),'')
    fresh=true
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/recovery-test?market=En`)
    await page.getByRole('button',{name:'Нет LinkedIn / аккаунт заблокирован',exact:true}).click()
    const freshForm=page.getByTestId('linkedin-new-form')
    const location=freshForm.getByLabel('Город и страна проживания',{exact:true})
    assert.equal(await location.inputValue(),'Tbilisi','new intake starts from the client-card location')
    assert.equal(await location.getAttribute('placeholder'),null)
    assert.equal(await freshForm.getByTestId('linkedin-outlook-details').isVisible(),true)
    assert.equal(await freshForm.getByTestId('outlook-instructions').evaluate(element=>element.open),true)
    assert.equal(await freshForm.getByTestId('outlook-instructions').locator('ol').isVisible(),true)
    assert.equal(writes,1,'viewing placeholders and instructions does not save defaults')
    assert.equal(banReports,1,'a repeated ban report is not sent again after the owner view records it')
    const date=freshForm.getByLabel('Дата и время регистрации Outlook-почты',{exact:true})
    const first=freshForm.getByLabel('Имя и Фамилия латиницей (как в документах)',{exact:true})
    const dateBox=await date.boundingBox(),firstBox=await first.boundingBox()
    assert.ok(Math.abs(dateBox.y-firstBox.y)<=1,'the date and first-name inputs align despite the timezone hint')
    await date.fill('2099-01-01')
    assert.equal(await date.evaluate(input=>input.validationMessage),'Дата и время регистрации не могут быть в будущем.')
    assert.equal(writes,1,'a future date is rejected before any request')
    await date.fill('2026-10-25');await page.getByLabel('Часы регистрации Outlook-почты',{exact:true}).selectOption('10');await page.getByLabel('Минуты регистрации Outlook-почты',{exact:true}).selectOption('30')
    await mkdir('tmp/denis-local-qa',{recursive:true})
    await page.screenshot({path:'tmp/denis-local-qa/student-desktop.png',fullPage:true,mask:[page.locator('input[type=password]')]})
    await page.setViewportSize({width:390,height:844})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
    await page.screenshot({path:'tmp/denis-local-qa/student-mobile.png',fullPage:true,mask:[page.locator('input[type=password]')]})
    assert.deepEqual(errors,[])
  }finally{await browser?.close();await server.close()}
})

test('all clients get combined Latin name and multiple desired locations; Unicode values survive saving', { timeout: 60000 }, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const fixture = `import {createApp,h,ref} from 'vue';import PrimeVue from 'primevue/config';
    import Profile from '/src/StudentProfile.vue';import Workflow from '/src/components/LinkedInOctoWorkflow.vue';
    const client=ref((await (await fetch('/api/client/me')).json()).client);
    const save=async patch=>{const response=await fetch('/api/client/me',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});const data=await response.json();client.value=data.client;return data;};
    createApp({render:()=>h('main',[h(Profile,{client:client.value,englishLevels:[{id:1,label:'B2'}],save}),h(Workflow,{client:client.value})])}).use(PrimeVue).mount('#app')`
  const server = await createServer({ configFile: false, root, cacheDir: 'node_modules/.vite-client-204-forms', plugins: [vue(), {
    name: 'client-form-pilot-fixture', resolveId: id => id === 'virtual:client-forms' ? '\0client-forms' : null,
    load: id => id === '\0client-forms' ? fixture : null,
    configureServer(s) { s.middlewares.use('/client-forms', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(await s.transformIndexHtml('/client-forms', '<div id="app"></div><script type="module" src="/@id/virtual:client-forms"></script>'))
    }) }
  }], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  let browser
  try {
    await server.listen(); browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    const clients = new Map(), names = new Map(), outlookLogins = new Map(), personalWrites = [], nameWrites = []
    let currentId = 204
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname
      const id = currentId
      if (!clients.has(id)) clients.set(id, { id, market: 'En', firstName: 'Кира', lastName: 'Самсонова', birthDate: '2000-04-20',
        englishLevelId: 1, readyForInterviewInEnglishIn2Months: 'No', noHigherEducation: true,
        educationEntries: [{ uni: 'School', yearOfEnd: '2020', city: 'Moscow' }], realLocation: 'Tbilisi, Georgia', desiredLocation: 'Remote',
        calendarEmail: 'student@gmail.com', telegramPersonalChatId: '@student_test' })
      if (!names.has(id)) names.set(id, { firstName: 'Mary Jane', lastName: 'van der Smith' })
      if (!outlookLogins.has(id)) outlookLogins.set(id, 'mary.smith@outlook.com')
      if (pathname === '/api/client/me') {
        if (route.request().method() === 'PATCH') {
          const patch = route.request().postDataJSON(); personalWrites.push({ id, patch })
          clients.set(id, { ...clients.get(id), ...patch })
        }
        return route.fulfill({ json: { client: clients.get(id) } })
      }
      if (pathname === '/api/client/linkedin-intake') {
        if (route.request().method() === 'PUT') {
          const data = parseIntake(route.request().postDataJSON()); nameWrites.push({ id, data }); names.set(id, { firstName: data.firstName, lastName: data.lastName })
          outlookLogins.set(id, data.outlookLogin)
          return route.fulfill({ json: { saved: true, task: { id: 1, status: 'не начата', created: false } } })
        }
        return route.fulfill({ json: { ...names.get(id), outlookLogin: outlookLogins.get(id), hasOutlookPassword: true,
          outlookRegisteredAt: '2026-10-25T08:30:00.000Z', realLocation: 'Tbilisi', blockedAccounts: [],
          registrationPending: true, task: { id: 1, status: 'не начата' } } })
      }
      return route.fulfill({ json: { profiles: [], requiredLocales: [], onboarding: { phase: 'idle' } } })
    })
    const visit = async id => {
      currentId = id
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/client-forms?client=${id}`)
      await page.getByTestId('linkedin-new-form').waitFor()
    }
    const combined = page.getByLabel('Имя и Фамилия латиницей (как в документах)', { exact: true })
    const first = page.getByLabel('Имя латиницей (как в иностранных документах)', { exact: true })
    const last = page.getByLabel('Фамилия латиницей (как в иностранных документах)', { exact: true })
    const saveName = async () => {
      const response = page.waitForResponse(r => r.url().endsWith('/api/client/linkedin-intake') && r.request().method() === 'PUT')
      await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
      assert.equal((await response).status(), 200)
      await page.getByText('Заявка обновлена', { exact: true }).waitFor()
    }
    for (const clientId of [204, 205]) {
      await page.setViewportSize({ width: 1440, height: 1000 })
      const previousNameWrites = nameWrites.length
      await visit(clientId)
      assert.equal(await combined.inputValue(), 'Mary Jane van der Smith')
      assert.equal(await first.count(), 0); assert.equal(await last.count(), 0)
      await saveName(); assert.deepEqual(names.get(clientId), { firstName: 'Mary Jane', lastName: 'van der Smith' })
      await combined.fill('Alex'); await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
      assert.equal(await combined.getAttribute('aria-invalid'), 'true'); assert.equal(nameWrites.length, previousNameWrites + 1)
      await combined.fill('José O’Connor')
      const outlookLogin = page.getByLabel('Логин от новой почты Outlook', { exact: true })
      assert.equal(await outlookLogin.getAttribute('aria-invalid'), 'true', 'changing the combined name revalidates the saved Outlook address')
      await outlookLogin.fill('jose.oconnor@outlook.com')
      assert.equal(await outlookLogin.getAttribute('aria-invalid'), 'false', 'Outlook validates against the newly entered combined name')
      await saveName()
      assert.deepEqual(names.get(clientId), { firstName: 'José', lastName: 'O’Connor' })
      await page.getByTestId('open-profile-editor-button').click()
      await page.getByTestId('profile-real-location').fill('São Paulo, Brazil')
      await page.getByTestId('profile-desired-location').fill(' São Paulo ,Brazil ; L’Haÿ-les-Roses, France ; remote; Mu\u0308nchen,Germany ')
      await page.getByTestId('save-profile-button').click(); await page.getByTestId('profile-form').waitFor({ state: 'detached' })
      const locations = 'São Paulo, Brazil; L’Haÿ-les-Roses, France; Remote; Mu\u0308nchen, Germany'
      assert.equal(personalWrites.at(-1).patch.desiredLocation, locations)
      assert.equal(personalWrites.at(-1).patch.realLocation, 'São Paulo, Brazil')
      await visit(clientId); assert.equal(await combined.inputValue(), 'José O’Connor')
      await page.getByTestId('open-profile-editor-button').click()
      assert.equal(await page.getByTestId('profile-desired-location').inputValue(), locations)
      assert.equal(await page.getByTestId('profile-real-location').inputValue(), 'São Paulo, Brazil')
      await mkdir('tmp/client-204-forms', { recursive: true })
      await page.screenshot({ path: `tmp/client-204-forms/client-${clientId}-desktop.png`, fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: `tmp/client-204-forms/client-${clientId}-mobile.png`, fullPage: true })
    }
    assert.equal(personalWrites.length, 2)
    assert.deepEqual(errors, [])
  } finally { await browser?.close(); await server.close() }
})
