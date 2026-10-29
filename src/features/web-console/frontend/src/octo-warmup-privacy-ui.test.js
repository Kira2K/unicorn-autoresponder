import {test} from 'node:test';import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url';import {createServer} from 'vite';import vue from '@vitejs/plugin-vue';import {chromium} from 'playwright'
test('warmup acknowledgment precedes grants and expert provenance removes previously loaded proxy credentials',{timeout:45000},async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),fixture=`import {createApp,h} from 'vue';import PrimeVue from 'primevue/config';import Access from '/src/components/OctoAccessCard.vue';createApp({render:()=>h(Access,{clientId:7,proxyExpanded:true,warmupUntil:new Date(Date.now()+86400000).toISOString()})}).use(PrimeVue).mount('#app')`
 const server=await createServer({configFile:false,root,cacheDir:'node_modules/.vite-octo-warmup',plugins:[vue(),{name:'warmup-test',resolveId:id=>id==='virtual:warmup'?'\0warmup':null,
  load:id=>id==='\0warmup'?fixture:null,configureServer(s){s.middlewares.use('/warmup-test',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/warmup-test','<div id="app"></div><script type="module" src="/@id/virtual:warmup"></script>'))})}}],server:{host:'127.0.0.1',port:0},logLevel:'error'})
 let browser
 try{
  await server.listen();browser=await chromium.launch();const page=await browser.newPage();page.setDefaultTimeout(12000)
  let managed=false,grants=0
  await page.route('**/api/octo/**',async route=>{
   const path=new URL(route.request().url()).pathname
   if(path.endsWith('/profiles/status'))return route.fulfill({json:{profiles:[{id:1,locale:'en',phase:'ready',canAcquire:true,canEditProxy:!managed,proxy:{configured:true,isMadeByExpert:managed,canViewCredentials:!managed,...(!managed?{credentialsLoaded:true,type:'socks5',host:'proxy.example',port:1080,login:'private-user',password:'private-secret'}:{})}}],requiredLocales:['en'],onboarding:{phase:'complete'}}})
   if(path.endsWith('/grants')){grants++;return route.fulfill({json:{id:'test-grant',phase:'preparing'}})}
   return route.fulfill({json:{id:'test-grant',phase:'preparing'}})
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/warmup-test`)
  await page.getByTestId('octo-proxy-1-login').waitFor();assert.equal(await page.getByTestId('octo-proxy-1-login').inputValue(),'private-user')
  const access=page.getByRole('button',{name:'Получить доступ',exact:true});await access.click()
  const dialog=page.getByRole('dialog',{name:'Доступ к Octo готов',exact:true});await dialog.waitFor();assert.equal(grants,0)
  await dialog.getByRole('button',{name:'Пока не открывать',exact:true}).click();assert.equal(grants,0)
  await access.click();await dialog.getByRole('button',{name:'Понятно, получить доступ',exact:true}).click()
  await page.getByText('Подготавливаем доступ…',{exact:true}).waitFor();assert.equal(grants,1)
  managed=true;await page.getByText('Прокси настроен командой.',{exact:true}).waitFor()
  assert.equal(await page.locator('.octo-proxy-form').count(),0)
  const inputs=await page.locator('input').evaluateAll(nodes=>nodes.map(input=>input.value))
  assert.ok(!inputs.includes('private-user')&&!inputs.includes('private-secret'))
 }finally{await browser?.close();await server.close()}
})
