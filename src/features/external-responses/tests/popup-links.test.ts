import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createPageReader} from '../vacancy_collection/page-reader.ts'

test('script and target-blank job links are captured without opening popups or forbidden hosts',async()=>{
  const chromium=createRequire(import.meta.url)('patchright').chromium
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()})
  try{
    const context=await browser.newContext(),requests:string[]=[]
    await context.route('**/*',(route:import('playwright').Route)=>{
      requests.push(route.request().url())
      return route.fulfill({contentType:'text/html',body:`<main><h1>Careers</h1><div role="listitem" onclick="window.open('https://roles.test/jobs/python','_blank')">Senior Python Developer</div><a target="_blank" href="https://roles.test/jobs/java">Senior Java Developer</a><div id="detached" onclick="setTimeout(()=>{const a=document.createElement('a');a.href='https://roles.test/jobs/go.pdf';a.target='_blank';a.click()},800)">Senior Golang Developer</div><div id="forbidden" onclick="window.open('https://linkedin.com/jobs/1')">Senior Go Developer</div></main>`})
    })
    const reader=createPageReader({context,minIntervalMs:0})
    for(const [selector,target] of [['[role="listitem"]','https://roles.test/jobs/python'],['a','https://roles.test/jobs/java'],['#detached','https://roles.test/jobs/go.pdf'],['#forbidden',null]] as [string,string|null][]){
      const page=await reader.read('https://fixture.test/careers',{steps:[{operation:'click',selector}]})
      if(target)assert.ok(page.links.some(l=>l.url===target&&l.kind==='posting'),JSON.stringify({selector,links:page.links}))
      else{assert.equal(page.partial,true);assert.ok(!page.links.some(l=>l.url.includes('linkedin')))}
      assert.equal(context.pages().length,0)
    }
    assert.ok(requests.every(url=>url==='https://fixture.test/careers'))
  }finally{await browser.close()}
})
