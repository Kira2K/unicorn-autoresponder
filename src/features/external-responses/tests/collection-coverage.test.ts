import test from 'node:test'
import assert from 'node:assert/strict'
import { vacancyLinks } from '../vacancy_collection/navigation.ts'
import { descriptionIssue } from '../vacancy_collection/description-quality.ts'
import { executeSource } from '../vacancy_collection/recipe.ts'
import { emptyMemory } from '../vacancy_collection/source-memory.ts'
import { scanCollection } from '../vacancy_collection/scan.ts'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { classifyWithReuse } from '../stack_classification/reuse.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'
import { readAts } from '../vacancy_collection/ats-reader.ts'
import { generateCollectionReport } from '../reporting/collection.ts'

const source={name:'Fixture',url:'https://example.test/careers',database:{sourceId:'1',companyId:'1',applicationRoute:'standard_workflow' as const}}
const board='https://job-boards.greenhouse.io/fixture'
const job={title:'Senior Java Engineer',company:'Fixture',url:board+'/jobs/123',applyUrl:board+'/jobs/123',location:'Sweden',description:'Responsibilities: develop reliable backend services in Java and Spring, implement APIs, and work with the product team on complete features.'}

test('career information routes do not consume vacancy traversal; real postings remain',()=>{
  const info=['about','training','career-path','privacy-cookies-policy','diversity','future-talent','sustainability','how-we-hire']
  const links=vacancyLinks([...info.map(x=>({text:x,url:'https://example.test/careers/'+x})),{text:'Senior Training Platform Engineer',url:'https://example.test/careers/training-platform-engineer'},{text:'Open jobs',url:'https://example.test/careers/vacancies'}],source.url)
  assert.equal(links.length,2)
  assert.ok(links.some(l=>l.url.endsWith('training-platform-engineer')))
})

test('plain career-detail links use stack title checks even without semantic card markup',async()=>{
  const {createTitlePrecheck}=await import('../vacancy_collection/title-precheck.ts')
  const titlePrecheck=createTitlePrecheck(await loadSelectionRules(),{stacks:[{id:'stack-5',databaseId:'5',name:'Java',description:'Java backend',studentIds:['1']}]})
  const reads:string[]=[]
  const result=await executeSource({source,memory:emptyMemory(),maxPages:3,titlePrecheck},{action:async()=>{},reader:{read:async url=>{
    reads.push(url);assert.equal(url,source.url)
    return {url,text:'Vacancies',jobs:[],links:[{text:'Software Development\nDynamics Finance Consultant',url:source.url+'/finance-consultant'},{text:'Senior UI Artist',url:source.url+'/ui-artist'}]}
  }}})
  assert.equal(reads.length,1);assert.equal(result.audit.status,'complete');assert.equal(result.audit.titlePrecheck?.skipped.length,2)
})

test('a detail page exposes the employer feed without following unrelated recommendation cards',async()=>{
  const detail='https://example.test/careers/senior-java',read:string[]=[]
  const result=await executeSource({source,memory:emptyMemory(),maxPages:3},{action:async()=>{},reader:{read:async url=>{
    read.push(url)
    if(url===source.url)return {url,text:'Careers',jobs:[],links:[{text:job.title,url:detail}]}
    if(url===detail)return {url,text:job.description,jobs:[{...job,url:detail,applyUrl:detail}],links:[{text:'Job openings',url:board},{text:'Other Java Engineer',url:'https://example.test/jobs/unrelated'}]}
    if(url===board)return {url,text:'All jobs',jobs:[job],links:[],completeListing:true}
    throw Error('unexpected_navigation')
  }}})
  assert.deepEqual(read,[source.url,detail,board]);assert.equal(result.audit.status,'complete')
})

test('complete inventory excludes irrelevant stubs but retained missing descriptions remain partial',async()=>{
  const {createTitlePrecheck}=await import('../vacancy_collection/title-precheck.ts')
  const titlePrecheck=createTitlePrecheck(await loadSelectionRules(),{stacks:[{id:'stack-5',databaseId:'5',name:'Java',description:'Java backend',studentIds:['1']}]})
  for(const title of ['Designer','Senior Java Engineer']) {
    const page=await readAts('https://jobs.lever.co/fixture',async()=>new Response(JSON.stringify([
      {text:job.title,hostedUrl:'https://jobs.lever.co/fixture/1',descriptionPlain:job.description},
      {text:title,hostedUrl:'https://jobs.lever.co/fixture/2',descriptionPlain:''}
    ])))
    assert.equal(page?.listingInventoryComplete,true);assert.equal(page?.partial,true)
    const result=await executeSource({source:{...source,url:page!.url},memory:emptyMemory(),maxPages:2,titlePrecheck},{reader:{read:async()=>page!},action:async()=>{}})
    assert.equal(result.audit.status,title==='Designer'?'complete':'partial')
    assert.equal(!!result.audit.trace?.recipe,title==='Designer')
  }
  const invalid=await readAts('https://jobs.lever.co/fixture',async()=>new Response(JSON.stringify([{text:'Designer',hostedUrl:'https://[bad'}])))
  assert.equal(invalid?.listingInventoryComplete,false);assert.equal(invalid?.partial,true)
})

test('recruitment warnings are not vacancy PDFs; actual job PDFs remain discoverable',()=>{
  const urls=vacancyLinks([
    {url:'https://example.test/careers/warnings-about-recruting-scams.pdf',text:'A Warning about Recruiting Scams'},
    {url:'https://example.test/careers/senior-fraud-engineer.pdf',text:'Senior Fraud Engineer'}
  ],source.url).map(l=>l.url)
  assert.deepEqual(urls,['https://example.test/careers/senior-fraud-engineer.pdf'])
})

test('Greenhouse embedded widgets identify their employer without carrying application tokens',()=>{
  const links=vacancyLinks([{text:'Job openings',url:'https://job-boards.greenhouse.io/embed/job_app?for=fixture&token=123&validityToken=secret'},{text:'ATS job openings',url:'https://job-boards.greenhouse.io/embed'}],source.url)
  assert.deepEqual(links.map(l=>l.url),['https://job-boards.greenhouse.io/fixture'])
})

test('Greenhouse retains the official custom posting URL for identity reuse',async()=>{
  const canonical='https://example.test/careers/positions/java/123/'
  const page=await readAts(board,async()=>new Response(JSON.stringify({jobs:[{id:123,title:job.title,content:job.description,absolute_url:canonical}]})))
  assert.equal(page?.jobs[0].url,canonical);assert.equal(page?.jobs[0].applyUrl,canonical)
})

test('newly discovered ATS boards outrank queued marketing links after a www redirect',async()=>{
  const entry={...source,url:'https://fixture.test/careers'},listing='https://www.fixture.test/careers/positions',reads:string[]=[]
  const result=await executeSource({source:entry,memory:emptyMemory(),maxPages:3},{action:async()=>{},reader:{read:async url=>{
    reads.push(url)
    if(url===entry.url)return {url:'https://www.fixture.test/careers',text:'Careers',jobs:[],links:[{text:'Open positions',url:listing},{text:'Our team',url:'https://www.fixture.test/careers/team'}]}
    if(url===listing)return {url,text:'Current listings',jobs:[],links:[{text:'Official employer job board',url:board}]}
    if(url===board)return {url,text:'Jobs',jobs:[job],links:[],completeListing:true}
    throw Error('marketing_detour')
  }}})
  assert.deepEqual(reads,[entry.url,listing,board]);assert.equal(result.audit.status,'complete')
})

test('verified complete ATS feed avoids detail repeats and irrelevant employer subpages',async()=>{
  const read:string[]=[]
  const result=await executeSource({source,memory:emptyMemory(),maxPages:3},{reader:{read:async url=>{
    read.push(url)
    if(url===source.url)return {url,text:'Careers',jobs:[],links:[{url:job.url,text:job.title},{url:board,text:'All jobs'},{url:'https://example.test/fr/careers',text:'Careers'},{url:'https://example.test/blog/software-engineer',text:'Engineering jobs'}]}
    if(url===board)return {url,text:'All jobs',jobs:[job],links:[{url:job.url,text:job.title}],completeListing:true,method:'greenhouse'}
    throw Error('unnecessary_detail_read')
  }},action:async()=>{}})
  assert.deepEqual(read,[source.url,board]);assert.equal(result.positions.length,1)
  assert.equal(result.audit.status,'complete');assert.ok(result.audit.trace?.recipe)
})

test('navigation keeps job pagination and board links but drops marketing and LinkedIn',()=>{
  const urls=['https://example.test/blog/java-jobs','https://example.test/developers/jobs','https://example.test/students/jobs','https://linkedin.com/jobs/123','https://lnkd.in/abc','https://example.test/jobs?page=2',board]
  const selected=vacancyLinks(urls.map(url=>({url,text:'Next page'})),source.url).map(l=>l.url)
  assert.deepEqual(selected,[board,'https://example.test/jobs?page=2'])
  assert.deepEqual(vacancyLinks([{url:'https://apply.talemetry.com/init-apply/fixture/job',text:'Apply Now'}],source.url),[])
  assert.deepEqual(vacancyLinks(['privacy-policy','refer-a-friend','terms-and-conditions'].map(path=>({url:'https://talent.sage.hr/jobs/example/'+path,text:path})),source.url),[])
  assert.deepEqual(vacancyLinks([{url:'https://example.test/react',text:'React-разработчик'}],'https://example.test/vacancies').map(l=>l.url),['https://example.test/react'])
  assert.deepEqual(vacancyLinks([{url:'https://example.test/react',text:'React-разработчик'}],'https://example.test/blog'),[])
})

test('Notion career navigation follows named roles on the same site only',()=>{
  const url='https://company.notion.site/Careers-11111111111111111111111111111111'
  const role='https://company.notion.site/Senior-Backend-Developer-22222222222222222222222222222222'
  assert.deepEqual(vacancyLinks([{url:role,text:'Senior Backend Developer'},{url:role.replace('company.','other.'),text:'Senior Backend Developer'},{url:'https://company.notion.site/Benefits-33333333333333333333333333333333',text:'Benefits'}],url).map(l=>l.url),[role])
})

test('vacancy details take priority over combinatorial career filters',()=>{
  const base='https://example.test/careers/job',detail=base+'/software-engineer-123'
  assert.deepEqual(vacancyLinks([{url:base+'?team=sales',text:'Sales 10 jobs'},{url:detail,text:'Software Engineer'},{url:base+'?language=english',text:'English'}],base).map(l=>l.url),[detail,base+'?team=sales',base+'?language=english'])
})

test('cookie-only bodies remain audit data, with zero semantic calls and no matched vacancies',async()=>{
  const cookie='We use cookies and tracking technologies to improve your browsing experience. Manage consent preferences, accept all cookies or customize privacy preferences.'
  assert.equal(descriptionIssue(cookie),'consent_or_cookie_body_without_job_details')
  assert.equal(descriptionIssue(job.description+' We use cookies.'),undefined)
  const scope=buildCampaignScope({database:'unicorn_noco_copy',stacks:[{id:'5',name:'Java',description:'Java backend'}],students:[{studentId:'1',stackId:'5'}]})
  const collection=await scanCollection({runId:'cookie-only',sources:[source],scope,force:true,maxPages:2,memories:new Map([['1',emptyMemory()]])},{reader:{read:async url=>({url,text:'Job',jobs:[{...job,description:cookie}],links:[]})},loadRun:async()=>{throw Error('none')},action:async()=>{}})
  assert.equal(collection.positions.length,1);assert.equal(collection.audit[0].status,'partial')
  let calls=0
  const result=await classifyWithReuse({collection,rules:await loadSelectionRules(),cache:{},policy:'fixture'},{assess:async()=>{calls++;throw Error('must not call')}})
  assert.equal(calls,0);assert.equal(result.classified.groups['stack-5'].matchedIds.length,0)
  assert.match(result.classified.globalDecisions![collection.positions[0].id].reasons.join(' '),/Substantive description/)
  assert.match(generateCollectionReport(result.classified).markdown,/not_attempted/)
})

test('company-only marketing copy is not accepted as a substantive job description',()=>{
  const boilerplate='ABOUT THE COMPANY\nAs a fast-growing, award-winning company, we power the industry with our products. With offices in Spain and Latvia, we offer a vibrant work culture and remote opportunities. Join us and unlock opportunities for growth.'
  assert.equal(descriptionIssue(boilerplate),'company_boilerplate_without_job_details')
  assert.equal(descriptionIssue(`${boilerplate}\nResponsibilities: build reliable Python services. Requirements: production backend experience.`),undefined)
})

test('repair skips identical replay; moved boards use a distinct bounded fallback',async()=>{
  const unchanged=await executeSource({source,memory:emptyMemory(),maxPages:4},{reader:{read:async url=>({url,text:'Empty shell',jobs:[],links:[],partial:true})},action:async()=>{}})
  assert.equal(unchanged.audit.trace?.requests,1);assert.equal(unchanged.audit.trace?.repairOutcome,'not_attempted')
  const memory={...emptyMemory(),recipe:{version:1 as const,revision:'old',verifiedAt:'2026-09-20',listingUrls:['https://old.test/careers'],methods:['browser'],controls:{},checks:{substantiveDescriptions:true as const,paginationComplete:true as const},origin:'observed' as const}}
  const result=await executeSource({source,memory,maxPages:3},{reader:{read:async url=>url.startsWith('https://old.test')?{url,text:'Moved',jobs:[],links:[],partial:true}:{url,text:'Jobs',jobs:[job],links:[],completeListing:true}},action:async()=>{}})
  assert.equal(result.audit.trace?.repairOutcome,'succeeded');assert.equal(result.audit.trace?.requests,2)
  assert.equal(result.audit.trace?.previousRecipe?.revision,'old');assert.ok(result.audit.trace?.recipe)
})

test('ATS completion flag requires a full board and complete descriptions, not a single job or stub',async()=>{
  const fetcher=async()=>new Response(JSON.stringify({jobs:[{id:123,title:job.title,content:job.description,location:{name:'Sweden'}}]}))
  assert.equal((await readAts(board,fetcher))?.completeListing,true)
  assert.equal((await readAts(board+'/jobs/123',fetcher))?.completeListing,false)
  assert.equal((await readAts(board,async()=>new Response(JSON.stringify({jobs:[{id:123,title:job.title,content:'Cookies'}]}))))?.completeListing,false)
})
