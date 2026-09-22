import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import express from 'express'
import {createLinkedInOrchestrator} from '../../linkedin-automation/orchestrator/service.ts'
import {createMemoryAutomationStore} from '../../linkedin-automation/orchestrator/memory-store.ts'
import {features,type AutomationAdapters} from '../../linkedin-automation/orchestrator/contracts.ts'
const require=createRequire(import.meta.url),{createWebConsoleApp}=require('../backend/app.ts')
const originalFetch=globalThis.fetch
globalThis.fetch=(input,options)=>{const url=new URL(String(input instanceof Request?input.url:input));
  if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('External network prohibited');return originalFetch(input,options)}
const store=createMemoryAutomationStore(),states=new Map()
const adapters=Object.fromEntries(features.map(feature=>[feature,{async inspect(){return {ready:true}},
  async start(run:any){const value={id:run.key,owned:true,state:feature==='comments'?'monitoring':'running'};states.set(run.key,value);return value},
  async status(run:any){return states.get(run.key)},async stop(run:any){states.set(run.key,{...states.get(run.key),state:'stopped'})}}])) as unknown as AutomationAdapters
const service=createLinkedInOrchestrator({store,adapters,authority:{assertOwned(){},async check(){}},
  now:()=>Date.parse('2026-09-21T07:00:00Z'),random:()=>0,accountExists:async id=>[103,203,303].includes(id)},false)
const app=createWebConsoleApp({useMockData:true,linkedinAutomation:service});app.use(express.static(resolve('dist/web-console')))
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r))
const browser=await chromium.launch()
try{
  await mkdir('.codex-tmp',{recursive:true})
  const page=await browser.newPage({viewport:{width:1600,height:1000}})
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
  await page.goto(`http://127.0.0.1:${(server.address() as any).port}`)
  await page.getByTestId('email-input').fill('unicornveryevil@gmail.com')
  await page.locator('input[type="password"]').fill('101010');await page.getByTestId('login-button').click()
  await page.getByTestId('admin-linkedin-tab').click()
  await page.getByLabel('Выбрать Connected Client',{exact:true}).waitFor()
  assert.equal(await page.locator('.manual-controls').count(),0,'Student list must not poll every hidden manual panel')
  await page.getByTestId('linkedin-open-103').click()
  await page.getByTestId('linkedin-manual-tab').click()
  await page.getByTestId('linkedin-manual-103').waitFor()
  assert.equal(await page.locator('.manual-controls').count(),1)
  await page.getByTestId('linkedin-open-203').click()
  assert.equal(await page.locator('.manual-controls').count(),1,'Status view must not mount another manual panel')
  await page.getByTestId('linkedin-manual-tab').click()
  await page.getByTestId('linkedin-manual-203').waitFor()
  assert.equal(await page.locator('.manual-controls').count(),2,'Visited panels retain their state')
  await page.getByLabel('Выбрать Connected Client',{exact:true}).check()
  await page.getByLabel('Выбрать Test Client',{exact:true}).check()
  const panel=page.getByTestId('linkedin-automation')
  await page.getByRole('button',{name:'Общее расписание',exact:true}).click()
  await panel.getByLabel('Автоматизация включена').check()
  await panel.getByRole('button',{name:'+ Добавить слот'}).click()
  await panel.getByRole('button',{name:'Сохранить для 2 учеников'}).click()
  await page.getByText('Сохранено: 2 из 2.').waitFor()
  assert.equal((await store.settings()).length,2)
  await service.tick()
  await store.appendEvent({at:Date.parse('2026-09-21T07:00:00Z'),account:203,feature:'invitations',
    stage:'provider_readback',code:'unipile_timeout',level:'error'})
  await page.getByRole('button',{name:'Обновить статус'}).click()
  await page.getByTestId('linkedin-history-view').click()
  await page.getByText('Unipile не ответил вовремя.',{exact:false}).waitFor()
  await page.screenshot({path:'.codex-tmp/linkedin-automation-desktop.png',fullPage:true})
  await page.getByTestId('automation-runs-collapse').click()
  await page.locator('#linkedin-automation-runs').waitFor()
  await page.getByTestId('automation-runs-collapse').click()
  assert.equal(await page.locator('#linkedin-automation-runs').count(),0)
  assert.ok((await store.settings()).every(s=>s.enabled),'Collapsing the list cannot disable work')
  await page.reload();await page.getByTestId('admin-linkedin-tab').click()
  await page.getByTestId('linkedin-history-view').click()
  await page.getByRole('button',{name:'Развернуть автозапуски'}).waitFor()
  assert.equal(await page.locator('#linkedin-automation-runs').count(),0)
  await page.getByTestId('linkedin-students-view').click()
  await page.getByLabel('Выбрать Connected Client',{exact:true}).check()
  await page.getByLabel('Выбрать Test Client',{exact:true}).check()
  await page.getByRole('button',{name:'Выключить выбранных'}).click()
  await page.waitForTimeout(250)
  assert.ok((await store.settings()).every(s=>!s.enabled))
  await page.setViewportSize({width:420,height:900})
  await page.screenshot({path:'.codex-tmp/linkedin-automation-mobile.png',fullPage:true})
  assert.deepEqual(errors,[])
  console.log('LinkedIn automation E2E passed: selection, bulk save, live status, durable error log, disable, mobile layout')
}finally{await browser.close();await service.close();await new Promise<void>((r,j)=>server.close((e:any)=>e?j(e):r()))}
