import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createPageReader} from '../vacancy_collection/page-reader.ts'
import {dismissCookieBanner} from '../vacancy_collection/cookie-banner.ts'
const launch=()=>createRequire(import.meta.url)('patchright').chromium.launch({headless:true,channel:'chromium'})

test('reader dismisses a shadow-DOM cookie rejection control and discovers the explicit BambooHR embed',async()=>{
 const browser=await launch()
 try{
  const context=await browser.newContext(),actions:string[]=[]
  await context.route('**/*',(route:any)=>route.fulfill({contentType:'text/html',body:new URL(route.request().url()).hostname==='fixture.test'?`<main><h1>Careers</h1><a href="#roles">See our open roles</a><div id="roles">Open jobs</div><iframe src="https://acme.bamboohr.com/jobs/embed2.php"></iframe></main><aside id="usercentrics-cmp-ui" style="position:fixed;inset:0;background:white;z-index:1000"></aside><script>const host=document.querySelector('aside');const root=host.attachShadow({mode:'open'});root.innerHTML='<button>Reject All</button>';root.querySelector('button').onclick=()=>host.remove();</script>`:'<html><body>Embedded listing</body></html>'}))
  const result=await createPageReader({context,minIntervalMs:0}).read('https://fixture.test/careers',{onAction:async a=>{actions.push(a.operation)}})
  assert.ok(actions.includes('dismiss_cookie_banner'));assert.ok(result.links.some(l=>l.url==='https://acme.bamboohr.com/careers'))
 }finally{await browser.close()}
})
test('cookie handling never accepts all cookies or clicks an unrelated/application control',async()=>{
 const browser=await launch()
 try{
  const page=await browser.newPage();await page.setContent('<button onclick="this.remove()">Reject All</button><div id="cookie-banner"><button>Accept All</button><form><button>Reject All</button></form></div>')
  assert.equal(await dismissCookieBanner(page),false);assert.equal(await page.locator('button').count(),3)
 }finally{await browser.close()}
})
test('reader preserves language-picker evidence even when labels do not match locale codes',async()=>{
 const browser=await launch()
 try{
  const context=await browser.newContext()
  await context.route('**/*',(route:any)=>route.fulfill({contentType:'text/html',body:'<h1>Careers</h1><nav class="language-picker"><a href="/cy/careers/">Greek</a></nav><a href="/en/careers-global/">Worldwide</a>'}))
  const result=await createPageReader({context,minIntervalMs:0}).read('https://fixture.test/en/careers/')
  assert.equal(result.links.find(l=>l.text==='Greek')?.languageAlternative,true)
  assert.equal(result.links.find(l=>l.text==='Worldwide')?.languageAlternative,undefined)
 }finally{await browser.close()}
})
test('a blocked anchor retains readable evidence as partial instead of losing the page',async()=>{
 const browser=await launch()
 try{
  const context=await browser.newContext()
  await context.route('**/*',(route:any)=>route.fulfill({contentType:'text/html',body:'<main><h1>Careers</h1><a href="#roles">See our open roles</a><div id="roles">Visible job evidence</div></main><aside style="position:fixed;inset:0;z-index:100;background:white">Unrecognized overlay</aside>'}))
  const result=await createPageReader({context,minIntervalMs:0}).read('https://fixture.test/careers')
  assert.equal(result.partial,true);assert.match(result.text,/Visible job evidence/)
 }finally{await browser.close()}
})
