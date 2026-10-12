import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { Route } from 'playwright'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'
import { createPageReader } from '../vacancy_collection/page-reader.ts'
import { readPublicPlatform } from '../vacancy_collection/public-platform-reader.ts'
import { createWebsiteStrategy } from '../vacancy_collection/discover.ts'
import { executeSource } from '../vacancy_collection/recipe.ts'
import { createTitlePrecheck } from '../vacancy_collection/title-precheck.ts'
import { emptyMemory, reusableSearch, sourceConfigHash } from '../vacancy_collection/source-memory.ts'
import { canonicalUrl } from '../infrastructure/identity.ts'

const require=createRequire(import.meta.url)
const loadPlaywright=()=>require('../../../platform/browser/playwright.ts').loadPlaywright()

const company = 'FixtureCompany'
const board = `https://jobs.smartrecruiters.com/${company}`
const posting = (id:string,name:string,releasedDate:string) => ({ id, uuid:`00000000-0000-4000-8000-${id.padStart(12,'0')}`, name, releasedDate, company:{identifier:company,name:'Fixture Company'}, location:{city:'Stockholm',country:'se',remote:true}, postingUrl:`${board}/${id}-${name.toLowerCase().replace(/[^a-z]+/g,'-')}`, applyUrl:`${board}/${id}-${name.toLowerCase().replace(/[^a-z]+/g,'-')}?oga=true` })

test('SmartRecruiters real list rows use their bound ref without requiring detail-only postingUrl',async()=>{
  const recent=new Date().toISOString(),item={id:'744000150342159',name:'Senior Golang Engineer',company:{identifier:company},releasedDate:recent,ref:`https://api.smartrecruiters.com/v1/companies/${company}/postings/744000150342159`}
  const list=await readPublicPlatform(board,async()=>new Response(JSON.stringify({limit:100,offset:0,totalFound:1,content:[item]})))
  assert.equal(list?.jobs.length,1);assert.equal(list?.partial,false)
  assert.equal(list?.jobs[0].description,'');assert.equal(list?.jobs[0].publishedAt,recent)
  assert.equal(canonicalUrl(list!.jobs[0].url),canonicalUrl(`${board}/${item.id}-senior-golang-engineer?oga=true`))
  const bad=await readPublicPlatform(board,async()=>new Response(JSON.stringify({limit:100,offset:0,totalFound:1,content:[{...item,ref:'https://api.smartrecruiters.com/v1/companies/Other/postings/'+item.id}]})))
  assert.equal(bad?.partial,true);assert.equal(bad?.jobs.length,0)
})

test('SmartRecruiters paginates metadata and applies title/date prechecks before separate detail reads',async()=>{
  const recent=new Date(Date.now()-86400000).toISOString(),old=new Date(Date.now()-30*86400000).toISOString()
  const junior=posting('100','Junior Java Developer',recent),expired=posting('200','Senior Java Engineer',old),kept=posting('300','Backend Engineer',recent)
  const calls:string[]=[]
  const fetcher:typeof fetch=async input=>{
    const url=String(input);calls.push(url)
    if(url.includes('offset=0'))return new Response(JSON.stringify({limit:100,offset:0,totalFound:3,content:[junior,expired]}))
    if(url.includes('offset=2'))return new Response(JSON.stringify({limit:100,offset:2,totalFound:3,content:[kept]}))
    if(url.endsWith('/postings/300'))return new Response(JSON.stringify({...kept,jobAd:{sections:{companyDescription:{title:'Company Description',text:'We build public software products.'},jobDescription:{title:'Job Description',text:'Responsibilities: build and operate reliable Python backend services and production APIs with the engineering team.'},qualifications:{title:'Qualifications',text:'Professional backend engineering, testing, and delivery experience.'}}}}))
    throw Error('Unexpected read: '+url)
  }
  const scope=buildCampaignScope({database:'fixture',stacks:[{id:'5',name:'Java',description:'Development stack'}],students:[{studentId:'1',stackId:'5'}]})
  const result=await createWebsiteStrategy({reader:{read:async url=>(await readPublicPlatform(url,fetcher))!},maxPages:8,concurrency:1,titlePrecheck:createTitlePrecheck(await loadSelectionRules(),scope)}).discover([{name:'Fixture Company',url:board}])
  assert.deepEqual(result.positions.map(position=>position.title),['Backend Engineer'])
  assert.match(result.positions[0].description,/reliable Python backend services/)
  assert.equal(result.positions[0].publishedAt,recent)
  assert.equal(result.positions[0].url,kept.postingUrl)
  assert.equal(result.positions[0].applyUrl,kept.applyUrl)
  assert.equal(result.audit[0].status,'complete')
  assert.equal(result.audit[0].titlePrecheck?.skipped[0].title,'Junior Java Developer')
  assert.equal(result.audit[0].publicationDatePrecheck?.outcomes[0].title,'Senior Java Engineer')
  assert.deepEqual(calls.filter(url=>/\/postings\/(?:100|200)$/.test(url)),[])
  assert.equal(calls.filter(url=>url.includes('/postings?')).length,2)
  assert.equal(calls.filter(url=>url.endsWith('/postings/300')).length,1)
})

test('SmartRecruiters malformed lists and missing detail fields remain explicitly partial',async()=>{
  await assert.rejects(readPublicPlatform(board,async()=>new Response('{}')),/validated postings list/)
  const detail=await readPublicPlatform(`${board}/300-backend-engineer`,async()=>new Response(JSON.stringify({name:'Backend Engineer',postingUrl:`${board}/300-backend-engineer`,jobAd:{sections:{jobDescription:{text:''}}}})))
  assert.equal(detail?.partial,true);assert.deepEqual(detail?.jobs,[]);assert.equal(detail?.explicitlyEmpty,undefined)
})

test('operator-unavailable source memory pauses recipe replay until explicit retry review',async()=>{
  const source={name:'Paused',url:'https://paused.test/careers'}
  const recipe={version:1 as const,revision:'saved',verifiedAt:'2026-09-29T00:00:00Z',listingUrls:[source.url],methods:['browser'],controls:{},checks:{substantiveDescriptions:true as const,paginationComplete:true as const},origin:'observed' as const}
  const memory={...emptyMemory(),recipe,state:{health:'unavailable',operatorAvailability:{status:'unavailable',reason:'Operator paused this source'},snapshot:{runId:'old',configHash:sourceConfigHash(source),status:'partial' as const,searchedAt:new Date().toISOString(),recipeRevision:recipe.revision}}}
  const before=JSON.stringify(memory);let reads=0
  assert.equal(reusableSearch(source,{...memory,state:{...memory.state,snapshot:{...memory.state.snapshot!,status:'complete'}}},Date.now(),false),false)
  const paused=await executeSource({source,memory,maxPages:2},{reader:{read:async()=>{reads++;throw Error('must not read')}},action:async()=>{}})
  assert.equal(reads,0);assert.equal(paused.audit.status,'unavailable');assert.equal(paused.audit.trace?.mode,'paused');assert.match(paused.audit.issues[0],/Operator paused/);assert.equal(JSON.stringify(memory),before)
  const retried=await executeSource({source,memory,maxPages:2,retryReview:true},{reader:{read:async url=>{reads++;return {url,text:'No current postings',jobs:[],links:[],explicitlyEmpty:true}}},action:async()=>{}})
  assert.equal(reads,1);assert.equal(retried.audit.status,'complete')
  const healthOnly=await executeSource({source,memory:{...emptyMemory(),state:{health:'unavailable'}},maxPages:2},{reader:{read:async()=>{throw Error('must not read')}},action:async()=>{}})
  assert.equal(healthOnly.audit.trace?.mode,'paused')
})

test('SageHR-style detail keeps all role sections while excluding application form and unrelated jobs',async()=>{
  const capturedPath=resolve('logs/external-responses/sol-three-successes-20260930/isolated/next-companies/audit/pages/77/read-3.json')
  const captured=JSON.parse(await readFile(capturedPath,'utf8'))
  assert.match(captured.text,/Python\/FastAPI/);assert.doesNotMatch(captured.jobs[0].description,/Python\/FastAPI/)
  const browser=await loadPlaywright().chromium.launch({headless:true,channel:'chrome'})
  try {
    const context=await browser.newContext()
    await context.route('**/*',(route:Route)=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<main>
      <h1>SENIOR PYTHON DEVELOPER — AI-FOCUS</h1>
      <script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title:'SENIOR PYTHON DEVELOPER — AI-FOCUS',url:captured.url,description:captured.jobs[0].description})}</script>
      <article><h2>About the company</h2><p>We build a production software platform.</p></article>
      <article class="block"><h2>SHORT DESCRIPTION</h2><p>We need an engineer who uses AI tools in a real production workflow.</p></article>
      <article class="block"><h2>REQUIREMENTS</h2><ul><li>Backend development with Python/FastAPI and production APIs.</li></ul></article>
      <article class="block"><h2>RESPONSIBILITIES</h2><p>Own delivery, testing, observability, and maintenance of reliable services.</p></article>
      <article class="block"><h2>PERKS AND BENEFITS</h2><p>Learning support and modern hardware.</p></article>
      <form><label>FIRST NAME <input></label><label>EMAIL <input type="email"></label><input type="file"><p>I AGREE TO TERMS &amp; CONDITIONS</p><button>Apply</button></form>
      <div class="other-jobs"><h2>Other jobs at the company</h2><a href="/jobs/other">EVENT MANAGER</a></div>
    </main>`}))
    const page=await createPageReader({context,minIntervalMs:0}).read(captured.url)
    assert.equal(page.jobs.length,1);assert.match(page.jobs[0].description,/AI tools/);assert.match(page.jobs[0].description,/Python\/FastAPI/);assert.match(page.jobs[0].description,/Learning support/)
    assert.doesNotMatch(page.jobs[0].description,/FIRST NAME|TERMS & CONDITIONS|Other jobs|EVENT MANAGER/)
  } finally {await browser.close()}
})
