import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createPageReader} from '../vacancy_collection/page-reader.ts'
import {createWebsiteStrategy} from '../vacancy_collection/discover.ts'
import {canonicalUrl,positionId} from '../infrastructure/identity.ts'
import {createTitlePrecheck} from '../vacancy_collection/title-precheck.ts'
import {loadSelectionRules} from '../stack_classification/rules.ts'
import {buildCampaignScope} from '../stack_catalog/campaign.ts'

test('observed numeric vacancy anchors are distinct; ordinary page anchors remain aliases',()=>{
  assert.notEqual(positionId('https://fixture.test/careers/#vacancy_description_1'),positionId('https://fixture.test/careers/#vacancy_description_2'))
  assert.equal(canonicalUrl('https://fixture.test/careers/#benefits'),canonicalUrl('https://fixture.test/careers'))
})
test('closed accessible panels are rejected by active-stack titles without fabricated URLs or clicks; eligible panels stay partial',async()=>{
  const chromium=createRequire(import.meta.url)('patchright').chromium
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()})
  try{
    const context=await browser.newContext()
    await context.route('**/*',(r:any)=>r.fulfill({contentType:'text/html',body:'<main><h1>Careers</h1>'+['Senior QA Engineer','Technical Project Manager','Graphic Designer'].map((title,i)=>`<button id="trigger-${i}" aria-expanded="false" aria-controls="" onclick="throw Error(\'must not click\')"><h3>${title}</h3></button>`).join('')+'</main>'}))
    const reader=createPageReader({context,minIntervalMs:0}),page=await reader.read('https://fixture.test/jobs/')
    assert.equal(page.unlinkedListings?.length,3);assert.equal(page.jobs.length,0)
    const scope=buildCampaignScope({database:'test',stacks:[{id:'3',name:'FullStack',description:'JS frontend/fullstack'}],students:[{studentId:'1',stackId:'3'}]})
    const precheck=createTitlePrecheck(await loadSelectionRules(),scope)
    const source={name:'Fixture',url:page.url}
    const collect=()=>createWebsiteStrategy({reader:{read:async()=>page},titlePrecheck:precheck,maxPages:1}).discover([source])
    const excluded=await collect();assert.equal(excluded.audit[0].status,'complete');assert.equal(excluded.audit[0].titlePrecheck?.skipped.length,3);assert.equal(excluded.positions.length,0)
    page.unlinkedListings!.push({title:'Senior Frontend Engineer',selector:'#real-role'})
    const unresolved=await collect();assert.equal(unresolved.audit[0].status,'partial');assert.equal(unresolved.positions.length,0);assert.match(unresolved.audit[0].issues.join(' '),/Senior Frontend/)
  }finally{await browser.close()}
})
test('public vacancy accordions retain full descriptions and distinct real anchors without clicking forms or rereading self-links',async()=>{
  const chromium=createRequire(import.meta.url)('patchright').chromium
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()})
  try{
    const context=await browser.newContext();await context.route('**/*',(r:any)=>r.fulfill({contentType:'text/html',body:`<main><h1>Open positions</h1>
      <a href="/careers">Careers</a>
      <button data-bs-target="#vacancy_description_1">Senior Python Developer</button><div id="vacancy_description_1" style="display:none"><div class="accordion-body"><p>Responsibilities: develop production Python services with FastAPI. Requirements: own APIs, SQL databases and deployment of reliable backend software.</p><p>Benefits: flexible hours and health insurance.</p><input type="email"><button>Apply</button></div></div>
      <button aria-controls="vacancy_description_2">Senior Golang Developer</button><div id="vacancy_description_2" hidden><p>Responsibilities: develop Go backend services, maintain production APIs and databases. Requirements: professional Go engineering and distributed systems experience.</p></div>
      <button data-bs-target="#faq_1">Question</button><div id="faq_1">Boilerplate</div></main>`}))
    const reader=createPageReader({context,minIntervalMs:0});const page=await reader.read('https://fixture.test/careers/')
    assert.equal(page.jobs.length,2);assert.match(page.jobs[0].description,/Benefits: flexible hours/);assert.doesNotMatch(page.jobs[0].description,/Apply|Boilerplate/)
    assert.equal(page.jobs[1].url,'https://fixture.test/careers/#vacancy_description_2')
    let reads=0;const result=await createWebsiteStrategy({reader:{read:async()=>{reads++;return page}},maxPages:5}).discover([{name:'Fixture',url:page.url}])
    assert.equal(reads,1);assert.equal(result.positions.length,2);assert.equal(result.audit[0].status,'complete')
  }finally{await browser.close()}
})
