import test from 'node:test'
import assert from 'node:assert/strict'
import { focusedInvestigation, assertInvestigation } from '../vacancy_collection/session-reasoner.ts'
import { vacancyLinks } from '../vacancy_collection/navigation.ts'

test('career subdomains do not turn culture or engineering service pages into vacancies',()=>{
  const links=[
    {text:'Working here',url:'https://careers.fixture.test/en/working-at-company/'},
    {text:'AI-enabled product engineering',url:'https://careers.fixture.test/services/ai-engineering'},
    {text:'Jobs',url:'https://careers.fixture.test/en/jobs/'},
    {text:'Senior Java Engineer',url:'https://careers.fixture.test/opening/123'},
    {text:'France',url:'https://careers.fixture.test/vacancies-countries/france'}
  ]
  assert.deepEqual(new Set(vacancyLinks(links,'https://careers.fixture.test/en/jobs/').map(l=>l.url)),new Set(links.slice(2).map(l=>l.url)))
})
test('Teamtailor employer navigation excludes the powered-by vendor and LinkedIn',()=>{
  const urls=['https://employer.teamtailor.com/','https://www.teamtailor.com/en/?utm_source=career-site','https://support.teamtailor.com/jobs','https://linkedin.com/company/example/jobs']
  assert.deepEqual(vacancyLinks(urls.map(url=>({url,text:'Careers'})),'https://employer.test/careers').map(l=>l.url),[urls[0]])
})

test('an employer board cannot expand into an ATS vendor recruitment site or general jobs aggregator',()=>{
  const urls=['https://jobs.workable.com/','https://www.personio.com/about-personio/careers/','https://www.bamboohr.com/careers/','https://employer.jobs.personio.de/job/123','https://apply.workable.com/employer/j/123/']
  assert.deepEqual(new Set(vacancyLinks(urls.map(url=>({url,text:'Careers'})),'https://employer.test/careers').map(l=>l.url)),new Set(urls.slice(3)))
})
test('old captured diagnostics remain unknown rather than becoming explicit zero observations', () => {
  const source = { name: 'Fixture', url: 'https://fixture.invalid/careers', database: { companyId: '140', sourceId: '67', applicationRoute: 'standard_workflow' } }
  const page = { url: source.url, text: 'Careers', links: [], jobs: [], diagnostics: { headings: ['Careers'] }, evidenceRef: 'fixture.json', evidenceHash: 'fixture-hash' }
  const result = focusedInvestigation({ runId: 'test', source, audit: { source, status: 'partial', found: 0, issues: ['incomplete'], pages: [] }, remainingReads: 190, remainingMs: 800000, attempt: 1 } as any, [page as any], false)
  const serialized = JSON.parse(JSON.stringify(result))
  assert.doesNotThrow(()=>assertInvestigation(serialized))
  assert.equal(serialized.packet.bytes,Buffer.byteLength(JSON.stringify(serialized)))
  assert.throws(()=>assertInvestigation({...serialized,remainingReads:999}),/hash_invalid/)
  assert.equal(Object.hasOwn(serialized.observations[0].diagnostics, 'cards'), false)
  assert.equal(Object.hasOwn(serialized.observations[0].diagnostics, 'listingRequests'), false)
  assert.equal(serialized.observations[0].evidenceRef, 'fixture.json')
  assert.deepEqual(serialized.observations[0].jobs, [])
})

test('large title-exclusion audit and page diagnostics cannot crowd out exact evidence references',()=>{
  const source={name:'Fixture',url:'https://fixture.invalid/careers',database:{companyId:'140',sourceId:'67',applicationRoute:'standard_workflow'}}
  const docs=Array.from({length:40},(_,i)=>({url:source.url+'/'+i,text:'x'.repeat(2000),links:[],jobs:[],diagnostics:{headings:Array(100).fill('large diagnostic heading')},evidenceRef:'pages/'+i+'.json',evidenceHash:String(i).padStart(64,'0')}))
  const result=focusedInvestigation({runId:'test',source,audit:{source,status:'partial',found:10,pages:docs.map(p=>p.url),issues:['pagination incomplete'],titlePrecheck:{skipped:Array(500).fill({title:'Junior',reason:'excluded',url:source.url})}},remainingReads:160,remainingMs:800000,attempt:1} as any,docs as any,false)
  assert.ok(Buffer.byteLength(JSON.stringify(result))<=32768)
  assert.doesNotThrow(()=>assertInvestigation(JSON.parse(JSON.stringify(result))))
  assert.equal(result.packet!.bytes,Buffer.byteLength(JSON.stringify(result)))
  assert.equal(result.observations.length,40)
  assert.ok(result.observations.every((p,i)=>p.evidenceRef===docs[i].evidenceRef&&p.evidenceHash===docs[i].evidenceHash))
})
