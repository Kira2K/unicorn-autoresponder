import test from 'node:test'
import assert from 'node:assert/strict'
import { executeSource } from '../vacancy_collection/recipe.ts'
import { emptyMemory } from '../vacancy_collection/source-memory.ts'
import { createTitlePrecheck } from '../vacancy_collection/title-precheck.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'
import { createPageReader } from '../vacancy_collection/page-reader.ts'
import { createRequire } from 'node:module'
import { vacancyLinks } from '../vacancy_collection/navigation.ts'
import { createWebsiteStrategy } from '../vacancy_collection/discover.ts'

test('structured non-stack career cards are title-filtered without opening their details',async()=>{
  const browser=await createRequire(import.meta.url)('patchright').chromium.launch({headless:true,channel:'chromium'})
  try {
    const context=await browser.newContext(),reads:string[]=[]
    await context.route('**/*',(route:import('playwright').Route)=>{reads.push(route.request().url());return route.fulfill({contentType:'text/html',body:'<h1>Vacancies</h1><a class="cards-item-inner" href="/careers/finance-consultant"><div class="cards-item-content"><h4>Finance Consultant</h4></div></a><a class="cards-item-inner" href="/careers/ui-artist"><h4>Senior UI Artist</h4></a>'})})
    const titlePrecheck=createTitlePrecheck(await loadSelectionRules(),{stacks:[{id:'stack-5',databaseId:'5',name:'Java',description:'Java backend',studentIds:['1']}]})
    const result=await executeSource({source:{name:'Fixture',url:'https://fixture.test/careers/vacancies'},memory:emptyMemory(),maxPages:4,titlePrecheck},{reader:createPageReader({context,minIntervalMs:0}),action:async()=>{}})
    assert.equal(result.positions.length,0);assert.equal(result.audit.status,'complete')
    assert.equal(result.audit.titlePrecheck?.skipped.length,2);assert.equal(reads.length,1)
  }finally{await browser.close()}
})

test('related role cards cannot suppress the actual headed vacancy description',async()=>{
  const browser=await createRequire(import.meta.url)('patchright').chromium.launch({headless:true,channel:'chromium'})
  try {
    const context=await browser.newContext()
    await context.route('**/*',(route:import('playwright').Route)=>route.fulfill({contentType:'text/html',body:'<main><h1>Senior Java Engineer</h1><section><h2>Requirements</h2><p>Build Java backend services with Spring and PostgreSQL. Maintain production APIs and implement reliable distributed systems.</p></section><a href="mailto:jobs@fixture.test">Apply</a><div class="related-jobs"><a href="/careers/other"><h3>Senior Go Engineer</h3>US only</a></div></main>'}))
    const page=await createPageReader({context,minIntervalMs:0}).read('https://fixture.test/careers/senior-java-engineer')
    assert.equal(page.jobs.length,1);assert.equal(page.jobs[0].title,'Senior Java Engineer')
    assert.match(page.jobs[0].description,/Spring/);assert.doesNotMatch(page.jobs[0].description,/US only/)
  }finally{await browser.close()}
})

test('full-feed ATS filter aliases are read once even when one unrelated description is missing',async()=>{
  const source={name:'Fixture',url:'https://fixture.test/careers'},board='https://jobs.lever.co/fixture',reads:string[]=[]
  const links=[{text:'All jobs',url:board},{text:'Europe',url:board+'?location=Europe'},{text:'Remote',url:board+'/?workplaceType=remote'}]
  const result=await createWebsiteStrategy({maxPages:10,reader:{read:async url=>{
    reads.push(url)
    return url===source.url?{url,text:'Careers',jobs:[],links}:{url,text:'Jobs',partial:true,completeListing:false,links:[],jobs:[{title:'Designer',company:'Fixture',url:board+'/1',applyUrl:board+'/1',location:'',description:''}]}
  }}}).discover([source])
  assert.deepEqual(reads,[source.url,board]);assert.equal(result.audit[0].status,'partial')
  assert.deepEqual(vacancyLinks([...links,{text:'Other employer',url:'https://jobs.lever.co/other?location=Europe'}],source.url).map(l=>l.url),[board,'https://jobs.lever.co/other'])
})

test('malformed non-job links cannot abort extraction of valid listings',async()=>{
  const browser=await createRequire(import.meta.url)('patchright').chromium.launch({headless:true,channel:'chromium'})
  try {
    const context=await browser.newContext()
    await context.route('**/*',(route:import('playwright').Route)=>route.fulfill({contentType:'text/html',body:'<main><h1>Careers</h1><a href="https://[broken"><h2>Engineer</h2></a><a href="/jobs/python"><h2>Senior Python Engineer</h2></a><a href="https://[invalid">Footer</a></main>'}))
    const page=await createPageReader({context,minIntervalMs:0}).read('https://fixture.test/careers')
    assert.equal(page.partial,false);assert.ok(page.links.some(l=>l.url==='https://fixture.test/jobs/python'&&l.kind==='posting'))
    assert.ok(page.links.every(l=>!l.url.includes('[broken')&&!l.url.includes('[invalid')))
  } finally {await browser.close()}
})

test('observed ATS posting selects its complete employer feed before locale/filter permutations',async()=>{
  const source={name:'Fixture',url:'https://fixture.test/vacancies?search=python'},board='https://boards.eu.greenhouse.io/fixture'
  const links=[{text:'Senior Java Engineer',url:board+'/jobs/123'},{text:'Spanish vacancies',url:'https://fixture.test/es/vacancies?department=Sales'}],reads:string[]=[]
  assert.equal(vacancyLinks(links,source.url)[0].url,board)
  const result=await createWebsiteStrategy({maxPages:5,reader:{read:async url=>{reads.push(url);return url===source.url?{url,text:'Careers',jobs:[],links}:{url,text:'All jobs',completeListing:true,links:[],jobs:[{title:'Senior Java Engineer',company:'Fixture',url:board+'/jobs/123',applyUrl:board+'/jobs/123',location:'',description:'Requirements: build Java backend services with Spring. Responsibilities: deliver reliable production APIs and maintain distributed systems.'}]}}}}).discover([source])
  assert.deepEqual(reads,[source.url,board]);assert.equal(result.audit[0].status,'complete');assert.equal(result.positions.length,1)
})

test('JazzHR observed posting links are collectable but submission action links remain excluded',()=>{
  const url='https://fixture.applytojob.com/apply/abc123/Senior-Python-Engineer'
  assert.equal(vacancyLinks([{text:'Senior Python Engineer',url}],'https://fixture.test/careers')[0].url,url)
  assert.deepEqual(vacancyLinks([{text:'Submit application',url}],'https://fixture.test/careers'),[])
})

test('a careers overview with one developer card follows its role URL instead of using company boilerplate',async()=>{
  const browser=await createRequire(import.meta.url)('patchright').chromium.launch({headless:true,channel:'chromium'})
  try {
    const context=await browser.newContext(),source={name:'Fixture',url:'https://fixture.test/career'}
    await context.route('**/*',(route:import('playwright').Route)=>route.fulfill({contentType:'text/html',body:route.request().url()===source.url?'<main><h1>Careers</h1><h2>General requirements</h2><p>Send a CV to join our global company.</p><a href="/career/python-developer"><h3>Python Developer</h3>Read requirements and apply</a></main>':`<main><h1>Python Developer</h1><h2>Requirements</h2><p>Build Python backend services with FastAPI, PostgreSQL and reliable production APIs. Own distributed systems and delivery.</p><a href="mailto:jobs@fixture.test">Send CV</a></main>`}))
    const reader=createPageReader({context,minIntervalMs:0})
    assert.equal((await reader.read(source.url)).jobs.length,0)
    const result=await createWebsiteStrategy({reader,maxPages:3}).discover([source])
    assert.equal(result.positions.length,1);assert.equal(result.positions[0].url,source.url+'/python-developer')
    assert.match(result.positions[0].description,/FastAPI/);assert.equal(result.audit[0].status,'complete')
  }finally{await browser.close()}
})

test('repair never promotes title/date-rejected links into unlabelled entry URLs', async () => {
  const source={name:'Fixture',url:'https://fixture.test/careers'}
  const policy=createTitlePrecheck(await loadSelectionRules(),{stacks:[{id:'stack-2',databaseId:'2',name:'Python',description:'Python backend',studentIds:['1']}]})
  const blocked=source.url+'/jobs/staff',old=source.url+'/jobs/python',reads:string[]=[]
  const result=await executeSource({source,memory:emptyMemory(),maxPages:10,titlePrecheck:policy},{action:async()=>{},reader:{read:async url=>{
    reads.push(url)
    if(url!==source.url)throw Error('rejected posting reopened')
    return {url,text:'Careers',partial:true,jobs:[{title:'Senior Python Engineer',url:old,applyUrl:old,company:'Fixture',location:'Remote',description:'',publishedAt:'2020-01-01'}],links:[{text:'Staff Engineer',url:blocked},{text:'Senior Python Engineer',url:old}]}
  }}})
  assert.deepEqual(reads,[source.url]);assert.equal(result.audit.trace?.repairOutcome,'not_attempted')
  assert.equal(result.audit.publicationDatePrecheck?.outcomes.length,1)
})

test('a completely traversed board with only date exclusions validates without inventing an empty state',async()=>{
  const source={name:'Fixture',url:'https://fixture.test/jobs'}
  const policy=createTitlePrecheck(await loadSelectionRules(),{stacks:[{id:'stack-2',databaseId:'2',name:'Python',description:'Python backend',studentIds:['1']}]})
  const result=await executeSource({source,memory:emptyMemory(),maxPages:5,titlePrecheck:policy},{action:async()=>{},reader:{read:async url=>({url,text:'Jobs',jobs:[{title:'Senior Python Engineer',url:url+'/1',applyUrl:url+'/1',company:'Fixture',location:'',description:'',publishedAt:'2020-01-01'}],links:[]})}})
  assert.equal(result.audit.status,'complete');assert.equal(result.positions.length,0);assert.ok(result.audit.trace?.recipe)
})

test('carousel next slide is not job pagination; genuine next page remains partial',async()=>{
  const browser=await createRequire(import.meta.url)('patchright').chromium.launch({headless:true,channel:'chromium'})
  try {
    const context=await browser.newContext()
    await context.route('**/*',(route:import('playwright').Route)=>route.fulfill({contentType:'text/html',body:`<main><h1>Careers</h1><a href="/jobs/python">Senior Python Engineer</a><button aria-label="${route.request().url().includes('pagination')?'Next page':'Next slide'}">→</button><section><h2>Team highlights</h2><button onclick="document.title='incorrect-click'">Load more</button></section></main>`}))
    const reader=createPageReader({context,minIntervalMs:0})
    const actions:string[]=[]
    const carousel=await reader.read('https://fixture.test/careers',{onAction:async a=>{actions.push(a.operation)}}),pagination=await reader.read('https://fixture.test/careers?pagination=1')
    assert.ok(actions.includes('non_listing_control_ignored'));assert.ok(!actions.includes('click'))
    assert.equal(carousel.partial,false)
    assert.equal(pagination.partial,true)
  } finally {await browser.close()}
})

test('blocked load-more control retains descriptions and records partial coverage instead of losing the whole page',async()=>{
  const browser=await createRequire(import.meta.url)('patchright').chromium.launch({headless:true,channel:'chromium'})
  try {
    const context=await browser.newContext(),actions:string[]=[]
    const url='https://fixture.test/jobs/python'
    await context.route('**/*',(route:import('playwright').Route)=>route.fulfill({contentType:'text/html',body:`<main><h1>Senior Python Engineer</h1><p>Requirements: develop Python backend services, maintain reliable APIs and production distributed systems.</p><script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:'Senior Python Engineer',url,description:'Requirements: develop Python backend services, maintain reliable APIs and production distributed systems.'})}</script><button>Load more</button></main><div style="position:fixed;inset:0;z-index:9999">Overlay</div>`}))
    const page=await createPageReader({context,minIntervalMs:0}).read(url,{onAction:async a=>{actions.push(a.operation)}})
    assert.equal(page.partial,true);assert.equal(page.jobs.length,1);assert.match(page.jobs[0].description,/Python backend/)
    assert.ok(actions.includes('pagination_control_unavailable'))
  }finally{await browser.close()}
})
