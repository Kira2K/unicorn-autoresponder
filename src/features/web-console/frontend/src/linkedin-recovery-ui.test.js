import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'

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
    let newTask=false,missingLatin=false,setupPhase='complete'
    const submissions=[]
    await page.route('**/api/**',async route=>{
      if(route.request().method()!=='GET'){
        writes++;assert.ok(allowSave,'opening/cancelling recovery must not write')
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
        task:status?{id:newTask?15:14,status}:undefined,linkedinAccountId:11,hasLinkedIn:!newTask,
        hadLinkedInBeforeTask:prior,previousOctoProfileIds:prior?[1]:[],
        registrationPending:!!status&&status!=='выполнение подтверждено',
        editLocked:['сделана экспертом','выполнение подтверждено'].includes(status),completionConfirmed:status==='выполнение подтверждено',
        url:'https://linkedin.com/in/fixture',login:'old@example.test',hasPassword:true,outlookLogin:'old@outlook.com',hasOutlookPassword:true,
        firstName:missingLatin?'Николай':'Alex',lastName:missingLatin?'Соколов':'Smith',realLocation:'Tbilisi',blockedAccounts:[{fullName:'Earlier account'}]
      }})
      return route.fulfill({json:{profiles:[{id:1,locale:'en',title:'Existing EN',phase:'ready',canAcquire:true,canEditProxy:true,proxy:{configured:true,type:'socks5',host:'proxy.example.test',port:1080,credentialsLoaded:true}},
        {id:2,locale:'en',title:'New EN',phase:'ready',canAcquire:false,canEditProxy:true,proxy:{configured:true}}],requiredLocales:['en'],onboarding:{phase:setupPhase}}})
    })
    const visit=async(dolphin,market,expectBan=true)=>{
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/recovery-test?dolphin=${dolphin?1:0}&market=${market}`)
      if(expectBan)await page.getByTestId('linkedin-report-ban').waitFor().catch(error=>{throw new Error(JSON.stringify({errors,error:error.message}))})
      else if(status==='сделана экспертом')await page.getByText('Заявка обработана экспертом. Для изменения данных обратитесь в поддержку.',{exact:true}).waitFor()
      else await page.getByTestId('linkedin-new-form').waitFor()
      assert.equal(await page.getByRole('button',{name:'Меня забанили',exact:true}).count(),expectBan?1:0)
    }
    for(const pending of ['не начата','блок']){
      status=pending;await visit(false,'En',false)
      await page.getByTestId('linkedin-registration-pending').waitFor()
      assert.equal(await page.locator('.scenario-buttons').count(),0)
      assert.equal(await page.getByTestId('linkedin-existing-form').count(),0,'an expert draft does not switch the active application to existing-account mode')
      assert.equal(await page.getByRole('button',{name:'Сохранить изменения',exact:true}).isEnabled(),true)
      assert.equal(await page.getByRole('button',{name:'Получить доступ',exact:true}).count(),0,'first registration never reveals freshly prepared profiles')
    }
    status='сделана экспертом';await visit(false,'En',false)
    await page.getByText('Заявка обработана экспертом. Для изменения данных обратитесь в поддержку.',{exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Получить доступ',exact:true}).count(),0)
    status='выполнение подтверждено'
    await page.getByTestId('octo-profile-1').getByRole('button',{name:'Получить доступ',exact:true}).waitFor()
    await page.getByTestId('linkedin-report-ban').waitFor()
    assert.equal(await page.getByTestId('linkedin-existing-form').count(),0)
    assert.equal(await page.locator('.octo-proxy-form').count(),0)
    // Polling locks and unlocks the same application without replacing an unsaved draft.
    prior=true;status='блок';setupPhase='provisioning'
    await page.getByRole('button',{name:'Сохранить изменения',exact:true}).waitFor()
    const outlookDetails=page.getByTestId('linkedin-outlook-details')
    const blockedDetails=page.getByTestId('linkedin-blocked-details')
    assert.equal(await outlookDetails.evaluate(element=>element.open),false)
    assert.equal(await blockedDetails.evaluate(element=>element.open),false)
    await blockedDetails.locator('summary').click()
    assert.equal(await blockedDetails.getByLabel('Какие имя и фамилия стояли?',{exact:true}).inputValue(),'Earlier account')
    await blockedDetails.locator('summary').click()
    await outlookDetails.getByText('Данные Outlook',{exact:true}).click()
    await page.getByTestId('octo-profile-1').waitFor()
    assert.equal(await page.getByTestId('octo-profile-1').getByRole('button',{name:'Получить доступ',exact:true}).isEnabled(),true,'a ready old profile stays usable while a new one is provisioning')
    setupPhase='complete'
    assert.equal(await page.getByTestId('octo-profile-2').count(),0,'new profiles are filtered from previous access')
    assert.equal(await page.locator('.octo-proxy-form').count(),0)
    await page.getByLabel('Город и страна проживания',{exact:true}).fill('Unsaved draft')
    status='не начата'
    await page.waitForTimeout(5200)
    assert.equal(await page.getByLabel('Город и страна проживания',{exact:true}).inputValue(),'Unsaved draft')
    status='сделана экспертом'
    await page.getByText('Заявка обработана экспертом. Для изменения данных обратитесь в поддержку.',{exact:true}).waitFor()
    assert.equal(await page.getByTestId('linkedin-new-form').count(),0)
    assert.equal(await page.getByTestId('octo-profile-1').count(),1)
    status='блок'
    await page.getByRole('button',{name:'Сохранить изменения',exact:true}).waitFor()
    await outlookDetails.getByText('Данные Outlook',{exact:true}).click()
    allowSave=true
    await page.getByLabel('Дата и время регистрации Outlook-почты',{exact:true}).fill('2026-10-25T10:30')
    await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click()
    await page.getByText('Заявка обновлена',{exact:true}).waitFor()
    assert.equal(await page.getByRole('dialog').count(),0,'editing an existing task does not show a new-registration success dialog')
    assert.equal(submissions[0].scenario,'new');assert.equal(submissions[0].replacesLinkedInAccountId,undefined)
    assert.equal(writes,1)
    writes=0;submissions.length=0;allowSave=false;status='выполнение подтверждено'
    for(const [dolphin,market] of [[false,'En'],[true,'En'],[true,'Ru']]){
      if(dolphin)status=''
      await visit(dolphin,market)
      await page.getByTestId('linkedin-report-ban').click()
      const form=page.getByTestId('linkedin-new-form');await form.waitFor()
      assert.equal(await form.getByLabel('Логин от новой почты Outlook',{exact:true}).inputValue(),'')
      assert.equal(await form.getByLabel('Пароль от новой почты Outlook',{exact:true}).getAttribute('required'),'')
      assert.equal(await form.getByLabel('Имя латиницей (как в иностранных документах)',{exact:true}).inputValue(),'Alex')
      assert.equal(await form.getByLabel('Город и страна проживания',{exact:true}).inputValue(),'Tbilisi','saved intake location is preserved')
      assert.equal(await form.locator('.blocked-account').count(),1)
      assert.equal(await page.getByRole('button',{name:'Меня забанили',exact:true}).count(),0)
      await page.getByRole('button',{name:'Отмена',exact:true}).click()
      await page.getByTestId('linkedin-report-ban').waitFor()
      assert.equal(await page.getByTestId('linkedin-new-form').count(),0)
    }
    assert.equal(writes,0)
    status='выполнение подтверждено';await visit(false,'En')
    await page.getByTestId('linkedin-report-ban').click()
    const form=page.getByTestId('linkedin-new-form')
    const email=form.getByLabel('Логин от новой почты Outlook',{exact:true})
    await email.fill('test@example.invalid')
    await form.getByLabel('Дата и время регистрации Outlook-почты',{exact:true}).fill('2026-10-25T10:30')
    await form.getByRole('button',{name:'Сохранить и подготовить Octo',exact:true}).click()
    const summary=form.getByTestId('linkedin-validation-error')
    await summary.waitFor()
    assert.match(await summary.innerText(),/Пароль от новой почты Outlook/)
    assert.equal(writes,0,'native required-field validation also explains why nothing was submitted')
    await form.getByLabel('Пароль от новой почты Outlook',{exact:true}).fill('fixture-password')
    await form.getByTestId('linkedin-outlook-details').getByText('Данные Outlook',{exact:true}).click()
    await form.getByRole('button',{name:'Сохранить и подготовить Octo',exact:true}).click()
    await summary.waitFor()
    assert.match(await summary.innerText(),/@outlook\.com/)
    assert.equal(await summary.getAttribute('role'),'alert')
    assert.equal(await email.evaluate(input=>document.activeElement===input),true)
    assert.equal(await form.getByTestId('linkedin-outlook-details').evaluate(element=>element.open),true,'an invalid hidden field reopens its accordion')
    assert.equal(await form.getByLabel('Пароль от новой почты Outlook',{exact:true}).inputValue(),'fixture-password','collapsing sections preserves the draft')
    assert.equal(writes,0,'invalid Outlook must not send a save request')
    await email.fill('replacement@outlook.com')
    assert.equal(await summary.count(),0,'correcting the email clears the stale error')
    allowSave=true
    await form.getByRole('button',{name:'Сохранить и подготовить Octo',exact:true}).click()
    await page.getByRole('dialog').waitFor()
    assert.equal(writes,1)
    assert.equal(submissions[0].replacesLinkedInAccountId,11)
    assert.equal(submissions[0].outlookLogin,'replacement@outlook.com')
    assert.equal(await page.getByRole('dialog').getByText('Пока ждёшь, пожалуйста, не заходи в профиль Octo: это может помешать регистрации.',{exact:true}).count(),0)
    newTask=false;status='выполнение подтверждено';missingLatin=true
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/recovery-test?market=En`)
    await page.getByTestId('linkedin-report-ban').click()
    assert.equal(await page.getByLabel('Имя латиницей (как в иностранных документах)',{exact:true}).inputValue(),'')
    assert.equal(await page.getByLabel('Фамилия латиницей (как в иностранных документах)',{exact:true}).inputValue(),'')
    fresh=true
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/recovery-test?market=En`)
    await page.getByRole('button',{name:'Нет LinkedIn / аккаунт заблокирован',exact:true}).click()
    const freshForm=page.getByTestId('linkedin-new-form')
    const location=freshForm.getByLabel('Город и страна проживания',{exact:true})
    assert.equal(await location.inputValue(),'','new intake does not silently reuse the client-card location')
    assert.equal(await location.getAttribute('placeholder'),'Tbilisi, Georgia')
    assert.equal(await freshForm.getByTestId('linkedin-outlook-details').evaluate(element=>element.open),true)
    assert.equal(await freshForm.getByTestId('outlook-instructions').evaluate(element=>element.open),true)
    assert.equal(await freshForm.getByTestId('outlook-instructions').locator('ol').isVisible(),true)
    assert.equal(writes,1,'viewing placeholders and instructions does not save defaults')
    assert.deepEqual(errors,[])
  }finally{await browser?.close();await server.close()}
})
