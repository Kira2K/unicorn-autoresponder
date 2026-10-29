import assert from 'node:assert/strict'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {mkdir} from 'node:fs/promises'
test('admin confirms through UI, distinguishes pending delivery, and reconciles a lost reply without another POST',{timeout:45000},async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url))
 const fixture=`import {createApp} from 'vue';import Confirm from '/src/components/LinkedInAdminConfirmations.vue';createApp(Confirm).mount('#app')`
 const server=await createServer({configFile:false,root,plugins:[vue(),{name:'admin-confirm-fixture',resolveId:id=>id==='virtual:admin-confirm'?'\0admin-confirm':null,
  load:id=>id==='\0admin-confirm'?fixture:null,configureServer(s){s.middlewares.use('/admin-confirm-test',async(_req,res)=>{
   res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/admin-confirm-test','<div id="app"></div><script type="module" src="/@id/virtual:admin-confirm"></script>'))})}}],server:{host:'127.0.0.1',port:0},logLevel:'error'})
 let browser
 try{
  await server.listen();browser=await chromium.launch();const page=await browser.newPage();page.setDefaultTimeout(10000)
  let status='сделана экспертом',notice='pending',posts=0,unknown=false
  const task=()=>({id:12,clientId:7,version:2,status,fio:'Test Admin Student',proxyProfileId:21,proxySavedAt:'2026-10-25T12:00:00Z'})
  await page.route('**/api/admin/linkedin-creation/tasks**',async route=>{
   const path=new URL(route.request().url()).pathname
   if(path.endsWith('/confirm')){posts++;assert.equal(route.request().postDataJSON().version,2);status='выполнение подтверждено';
    if(unknown)return route.fulfill({status:503,json:{error:'commit_uncertain'}})
   }
   if(path.endsWith('/octo/status'))return route.fulfill({json:{profiles:[{id:21,phase:'ready',canEditProxy:true,proxy:{configured:true,credentialsLoaded:true,type:'socks5',host:'proxy.example',port:1080,login:'fixture',password:'fixture'}}]}})
   if(path.endsWith('/tasks'))return route.fulfill({json:[task()]})
   return route.fulfill({json:{task:task(),client:{id:7,fio:'Test Admin Student'},intake:{url:'https://linkedin.com/in/test',login:'test@example.invalid',hasPassword:true,outlookRegisteredAt:'2026-10-25T10:30:00.000Z'},notification:{state:notice,...(notice==='sent'?{messageId:77}:{})}}})
  })
  const open=async()=>{await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/admin-confirm-test`);await page.getByTestId('admin-creation-task-12').click()}
  await open();await page.getByTestId('admin-confirm-creation').waitFor()
  await mkdir('tmp/denis-local-qa',{recursive:true})
  await page.screenshot({path:'tmp/denis-local-qa/admin-confirmation.png',fullPage:true,mask:[page.locator('input')]})
  await page.getByTestId('admin-confirm-creation').click()
  await page.getByTestId('admin-creation-status').filter({hasText:'выполнение подтверждено'}).waitFor()
  assert.match(await page.getByTestId('admin-confirmation-notification').innerText(),/Ожидаем отправки/)
  notice='sent';await page.getByText('Уведомление отправлено. Сообщение №77.',{exact:true}).waitFor();assert.equal(posts,1)
  status='сделана экспертом';notice='pending';unknown=true;await open();await page.getByTestId('admin-confirm-creation').click()
  await page.getByRole('alert').filter({hasText:'Результат подтверждения неизвестен'}).waitFor()
  assert.equal(await page.getByTestId('admin-confirm-creation').isDisabled(),true)
  await page.getByRole('button',{name:'Перечитать результат',exact:true}).click()
  await page.getByTestId('admin-creation-status').filter({hasText:'выполнение подтверждено'}).waitFor();assert.equal(posts,2)
 }finally{await browser?.close();await server.close()}
})
