import assert from 'node:assert/strict'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {mkdir} from 'node:fs/promises'
test('admin history shows two independent deliveries and only performs reads',{timeout:45000},async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url))
 const fixture=`import {createApp} from 'vue';import Confirm from '/src/components/LinkedInAdminConfirmations.vue';createApp(Confirm).mount('#app')`
 const server=await createServer({configFile:false,root,plugins:[vue(),{name:'admin-confirm-fixture',resolveId:id=>id==='virtual:admin-confirm'?'\0admin-confirm':null,
  load:id=>id==='\0admin-confirm'?fixture:null,configureServer(s){s.middlewares.use('/admin-confirm-test',async(_req,res)=>{
   res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/admin-confirm-test','<div id="app"></div><script type="module" src="/@id/virtual:admin-confirm"></script>'))})}}],server:{host:'127.0.0.1',port:0},logLevel:'error'})
 let browser
 try{
  await server.listen();browser=await chromium.launch();const page=await browser.newPage();page.setDefaultTimeout(10000)
  let notice='pending',reads=0
  const task=()=>({id:12,clientId:7,version:2,status:'сделана экспертом',fio:'Test Admin Student'})
  await page.route('**/api/admin/linkedin-creation/tasks**',async route=>{
   assert.equal(route.request().method(),'GET','history never sends a completion command')
   const path=new URL(route.request().url()).pathname
   if(path.endsWith('/tasks'))return route.fulfill({json:[task()]})
   reads++
   return route.fulfill({json:{task:task(),client:{id:7,fio:'Test Admin Student'},intake:{url:'https://linkedin.com/in/test',login:'test@example.invalid',hasPassword:true},notification:{deliveries:[
    {recipient:'reports',state:'sent',messageId:77},{recipient:'student',state:notice,...(notice==='sent'?{messageId:78}:{})}
   ]}}})
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/admin-confirm-test`)
  await page.getByTestId('admin-creation-task-12').click()
  await page.getByTestId('admin-creation-status').filter({hasText:'сделана экспертом'}).waitFor()
  assert.equal(await page.getByTestId('admin-confirm-creation').count(),0)
  const deliveries=page.getByTestId('admin-completion-deliveries')
  await deliveries.getByText('Ботоотчёты: Отправлено. Сообщение №77.',{exact:true}).waitFor()
  await deliveries.getByText('Ученику: Ожидает отправки.',{exact:true}).waitFor()
  notice='sent';await deliveries.getByText('Ученику: Отправлено. Сообщение №78.',{exact:true}).waitFor()
  notice='uncertain';await page.getByRole('button',{name:'Перечитать результат',exact:true}).click()
  await deliveries.getByText('Ученику: Доставка не подтверждена; автоматического повтора нет.',{exact:true}).waitFor()
  assert.ok(reads>=3)
 }finally{await browser?.close();await server.close()}
})
