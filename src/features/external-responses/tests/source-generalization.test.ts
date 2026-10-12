import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {executeSource} from '../vacancy_collection/recipe.ts'
import {emptyMemory} from '../vacancy_collection/source-memory.ts'
import {createPageReader} from '../vacancy_collection/page-reader.ts'
import {createWebsiteStrategy} from '../vacancy_collection/discover.ts'
import {createTitlePrecheck} from '../vacancy_collection/title-precheck.ts'
import {loadSelectionRules} from '../stack_classification/rules.ts'
import {vacancyLinks} from '../vacancy_collection/navigation.ts'

test('explicit other-employer links never produce navigation or derived ATS boards',()=>{
  const links=[
    {text:'Explore open positions',url:'https://careers.fixture.test/'},
    {text:'Careers at FIXTURE',url:'https://jobs.ashbyhq.com/fixture'},
    {text:'Openings at Sister\nSister is another business',url:'https://jobs.ashbyhq.com/sister/abc'},
    {text:'Jobs with Partner',url:'https://partner.test/careers'},
  ]
  assert.deepEqual(new Set(vacancyLinks(links,'https://fixture.test/careers','Fixture').map(l=>l.url)),new Set(links.slice(0,2).map(l=>l.url)))
})

test('source traversal and bounded repair both preserve the explicit employer boundary',async()=>{
  for(const complete of [true,false]){
    const source={name:'Fixture',url:'https://fixture.test/careers'},board='https://careers.fixture.test/',reads:string[]=[]
    const result=await executeSource({source,memory:emptyMemory(),maxPages:6},{action:async()=>{},reader:{read:async url=>{
      reads.push(url)
      if(url===source.url)return {url,text:'Careers',jobs:[],links:[{text:'Explore open positions',url:board},{text:'Openings at Sister\nAnother group business',url:'https://www.comeet.com/jobs/sister/1'}]}
      if(url===board)return {url,text:complete?'No open positions':'Loading jobs',explicitlyEmpty:complete,partial:!complete,jobs:[],links:[]}
      throw Error('cross_company_navigation')
    }}})
    assert.deepEqual(reads,[source.url,board]);assert.equal(result.audit.status,complete?'complete':'partial')
  }
})

const body='Responsibilities: build production Python services with FastAPI and PostgreSQL. Requirements: maintain reliable APIs and own delivery of backend software.'
const job=(url:string)=>({title:'Senior Python Engineer',url,applyUrl:url,company:'Fixture',location:'Remote',description:body})

test('stale custom careers URL recovers through observed homepage links within the original read budget',async()=>{
  for(const host of ['one.test','two.test']){
    const source={name:'Fixture',url:`https://${host}/jobs`},home=`https://${host}/`,board=`https://${host}/new-careers`,reads:string[]=[]
    const result=await executeSource({source,memory:emptyMemory(),maxPages:3},{action:async()=>{},reader:{read:async url=>{
      reads.push(url)
      if(url===source.url)return {url,text:'Not found',jobs:[],links:[],closedEvidence:'Official URL returned HTTP 404'}
      if(url===home)return {url,text:'Welcome',jobs:[],links:[{text:'Careers',url:board}]}
      if(url===board)return {url,text:'Jobs',jobs:[job(board+'/python')],links:[],completeListing:true}
      throw Error('unexpected_url')
    }}})
    assert.deepEqual(reads,[source.url,home,board]);assert.equal(result.audit.status,'complete');assert.equal(result.positions.length,1)
    assert.deepEqual(result.audit.trace?.recipe?.listingUrls,[board]);assert.equal(result.audit.trace?.requests,3)
  }
})

test('recovery never guesses an ATS vendor homepage or bypasses an access barrier',async()=>{
  for(const url of ['https://jobs.lever.co/missing','https://jobs.ashbyhq.com/missing','https://fixture.test/jobs']){
    const reads:string[]=[]
    const result=await executeSource({source:{name:'Fixture',url},memory:emptyMemory(),maxPages:5},{action:async()=>{},reader:{read:async u=>{
      reads.push(u);return {url:u,text:'Unavailable',jobs:[],links:[],...(u.includes('fixture.test')?{accessGate:{kind:'login_required' as const,url:u,evidence:'Sign in to see vacancies'}}:{closedEvidence:'Official URL returned HTTP 404'})}
    }}})
    assert.deepEqual(reads,[url]);assert.notEqual(result.audit.status,'complete')
  }
})

test('successful alternate extraction cannot erase inspected vacancies or the unresolved first coverage gap',async()=>{
  const source={name:'Fixture',url:'https://fixture.test/new-jobs'},old='https://fixture.test/old-jobs',memory=emptyMemory()
  memory.recipe={version:1,revision:'old',verifiedAt:new Date().toISOString(),listingUrls:[old],methods:['reader'],controls:{},checks:{substantiveDescriptions:true,paginationComplete:true},origin:'observed'}
  const result=await executeSource({source,memory,maxPages:3},{action:async()=>{},reader:{read:async url=>({url,text:'Jobs',links:[],jobs:[job(url+'/python')],...(url===old?{partial:true}:{completeListing:true})})}})
  assert.equal(result.positions.length,2);assert.equal(result.audit.status,'partial');assert.equal(result.audit.trace?.recipe,undefined)
})

test('job-card structure generalizes across URL paths and heading levels without promoting overview prose',async()=>{
  const browser=await createRequire(import.meta.url)('patchright').chromium.launch({headless:true})
  try{
    const context=await browser.newContext(),policy=createTitlePrecheck(await loadSelectionRules(),{stacks:[{id:'stack-2',databaseId:'2',name:'Python',description:'Python backend',studentIds:['1']}]})
    for(const [path,tag] of [['/careers','h1'],['/work-with-us','h2'],['/jobs','h3']]){
      const source={name:'Fixture',url:'https://cards.test'+path},target='https://cards.test/role/python'
      await context.route('**/*',(route:import('playwright').Route)=>route.fulfill({contentType:'text/html',body:route.request().url()===target?`<main><h1>Senior Python Engineer</h1><h2>Requirements</h2><p>${body}</p><p>Send your CV to apply.</p></main>`:`<main><h1>Careers</h1><p>Our general requirements for joining the company. Send a CV to apply.</p><a href="${target}"><${tag}>Senior Python Engineer</${tag}>Read more</a><a href="/role/sales"><h3>Sales Representative</h3></a></main>`}))
      const reader=createPageReader({context,minIntervalMs:0}),page=await reader.read(source.url)
      assert.deepEqual(page.jobs,[],path+' must remain a listing')
      const reads:string[]=[]
      const result=await createWebsiteStrategy({reader:{read:async url=>{reads.push(url);return reader.read(url)}},maxPages:3,titlePrecheck:policy}).discover([source])
      assert.equal(result.positions.length,1,path);assert.equal(result.positions[0].url,target);assert.equal(result.audit[0].status,'complete')
      assert.ok(!reads.includes('https://cards.test/role/sales'))
      await context.unrouteAll()
    }
  }finally{await browser.close()}
})
