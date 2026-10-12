import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'
import { createWebsiteStrategy } from '../vacancy_collection/discover.ts'
import { executeSource } from '../vacancy_collection/recipe.ts'
import { scanCollection } from '../vacancy_collection/scan.ts'
import { emptyMemory, reusableSearch, sourceConfigHash } from '../vacancy_collection/source-memory.ts'
import { createTitlePrecheck, titlePrecheckPositions } from '../vacancy_collection/title-precheck.ts'

const source = { name: 'Example', url: 'https://example.test/jobs', database: { sourceId: '1', companyId: '1', applicationRoute: 'standard_workflow' as const } }
const scope = (ids = ['2', '3', '5', '7']) => buildCampaignScope({
  database: 'fixture',
  stacks: ids.map(id => ({ id, name: `Stack ${id}`, description: 'Development stack' })),
  students: ids.map(id => ({ studentId: `student-${id}`, stackId: id })),
  capturedAt: '2026-09-29T00:00:00.000Z',
})
const job = (title:string, id:string, description='Short listing card') => ({ title, company: source.name, url: `${source.url}/${id}`, applyUrl: `${source.url}/${id}`, location: 'Worldwide', description })

test('benchmark noise and inactive stacks are rejected; active engineering routes remain', async () => {
  const precheck = createTitlePrecheck(await loadSelectionRules(), scope())
  for (const title of ['Support Engineer','Customer Support Engineer','Sales Engineer','Head of Finance','Lead Engineer, AI Quality','1st line Support Specialist', 'Finance Manager', 'Senior Account Sales Executive (USA)', 'Patient Access Liaison (Atlanta, GA)', 'Senior Patient Access Liaison (Central)', 'Customer Success Specialist (Remote)', 'QA Technical Lead (Python)', 'Software QA Engineering Bootcamp', 'QA Bundle: From Zero To QA Automation', 'Support Specialist / Software Developer']) assert.equal(precheck.evaluate(title).decision, 'excluded', title)
  for (const title of ['Senior Golang Engineer', 'Middle Java Developer', 'R&D Engineer', 'Senior Software Engineer', 'Software Engineer — finance systems','Forward Deployed Engineer','AI Product Engineer','Middle applied AI / LLM Engineer (Python)']) assert.equal(precheck.evaluate(title).decision, 'continue', title)
  for (const title of ['Senior FullStack QA Engineer with Python (Programming language)','DevOps Engineer','SRE','SDET','AQA','QA Tester','Project Manager','Product Manager','Senior PHP Backend Engineer','Senior C++ Software Developer']) assert.equal(precheck.evaluate(title).decision,'excluded',title)
  for(const title of ['AI Product Engineer','AI-Enhanced Software Engineer - Customer Intelligence','Middle applied AI / LLM Engineer (Python)']) assert.deepEqual(precheck.evaluate(title), {decision:'continue',family:'emerging_engineering',inspectDescription:true,candidateStackIds:['stack-3']})
})

test('stack routes intersect the selected populated scope and testing wins over language/fullstack',async()=>{
  const rules=await loadSelectionRules(),route=(title:string,ids:string[])=>createTitlePrecheck(rules,scope(ids)).evaluate(title)
  assert.deepEqual(route('Senior Golang Engineer',['2','5','7']),{decision:'continue',family:'development',candidateStackIds:['stack-7']})
  assert.deepEqual(route('Middle Java Developer',['2','5','7']),{decision:'continue',family:'development',candidateStackIds:['stack-5']})
  for(const title of ['Senior Frontend Engineer','Forward Deployed Engineer','AI Engineer','AI-Enhanced Software Engineer'])assert.equal(route(title,['2','5','7']).decision,'excluded',title)
  for(const title of ['QA Engineer','SDET','Manual Tester','Python QA Engineer','Senior FullStack QA Engineer with Python','Senior Automation Engineer','Java Automation Engineer']) {
    const result=route(title,['2','3','5','7','13','18'])
    assert.equal(result.decision,'continue',title)
    if(result.decision==='continue')assert.deepEqual(result.candidateStackIds,['stack-13','stack-18'],title)
  }
  for(const title of ['AI/ML Engineer','AI Platform Engineer','Machine Learning Engineer','Forward-Deployed AI Engineer']) {
    const result=route(title,['2','3','5','7'])
    assert.equal(result.decision,'continue',title)
    if(result.decision==='continue')assert.deepEqual(result.candidateStackIds,['stack-3'])
    assert.equal(route(title,['2','5','7']).decision,'excluded')
  }
  const multi=route('Python / Go / Java Engineer',['2','5','7'])
  if(multi.decision==='continue')assert.deepEqual(multi.candidateStackIds,['stack-2','stack-5','stack-7']);else assert.fail('Multi-language title must route to each selected language')
  const empty=scope(['7']);empty.stacks=[]
  assert.equal(createTitlePrecheck(rules,empty).evaluate('Senior Golang Engineer').decision,'excluded')
})

test('classification excludes noisy titles without assessor calls and still assesses engineering roles', async () => {
  const { classifyVacancies } = await import('../stack_classification/index.ts')
  const calls:string[] = [], campaign = scope(['2', '5', '7'])
  const positions = ['Finance Manager', 'Senior Golang Engineer', 'Middle Java Developer'].map((title, i) => ({...job(title, String(i), 'Responsibilities include building reliable backend services and APIs, delivering production software and maintaining databases with the engineering team.'), id: String(i), source, retrievedAt: '2026-09-30T00:00:00.000Z'}))
  const collection:any = {version:1, runId:'precheck-regression', sources:[source], positions, audit:[], createdAt:'2026-09-30T00:00:00.000Z', scope:campaign}
  const result = await classifyVacancies({collection, selectionRules:await loadSelectionRules()}, {assessGlobal:async position=>{calls.push(position.title);return {decision:'review', reasons:['Semantic review recorded'], evidence:[position.title]}}})
  assert.deepEqual(calls, ['Senior Golang Engineer', 'Middle Java Developer'])
  assert.equal(result.globalDecisions?.['0'].decision, 'excluded')
  assert.equal(result.semanticAssessments?.['0'], undefined)
})

test('combined assessment and session packets use only routed stacks; no unrelated pending or duplicate calls',async()=>{
  const {classifyWithReuse}=await import('../stack_classification/reuse.ts')
  const {assertClassificationIntegrity}=await import('../stack_classification/index.ts')
  const {buildAssessmentPacket}=await import('../stack_classification/session-packet.ts')
  const rules=await loadSelectionRules(),campaign=scope(['2','5','7']),calls:string[][]=[]
  const positions=['Senior Golang Engineer','DevOps Engineer','Senior PHP Backend Engineer'].map((title,i)=>({...job(title,String(i),'Responsibilities: build reliable backend services in Go and maintain production APIs and databases. Requirements: Golang development experience, distributed systems and software testing. The engineering team delivers reliable software for customers worldwide.'),id:String(i),source,retrievedAt:'2026-09-30T00:00:00.000Z'}))
  const collection:any={version:1,runId:'routing',sources:[source],positions,audit:[{source,status:'complete',pages:[source.url],found:3,issues:[]}],createdAt:'2026-09-30T00:00:00.000Z',scope:campaign}
  const decision=(p:any)=>({decision:'eligible' as const,reasons:['Fixture full-description assessment'],evidence:[p.title]})
  const first=await classifyWithReuse({collection,rules,policy:'test',cache:{}},{assess:async(p,stacks)=>{calls.push(stacks.map(s=>s.id));return {global:decision(p),stacks:Object.fromEntries(stacks.map(s=>[s.id,decision(p)]))}}})
  assert.deepEqual(calls,[['stack-7']]);assert.deepEqual(first.classified.groups['stack-7'].matchedIds,['0'])
  assert.deepEqual(first.classified.groups['stack-2'].reviewIds,[]);assert.deepEqual(first.classified.groups['stack-5'].matchedIds,[])
  assertClassificationIntegrity(first.classified)
  const second=await classifyWithReuse({collection,rules,policy:'test',cache:first.updates},{assess:async()=>{throw Error('cache should avoid call')}})
  assert.equal(second.classified.evaluation?.hits,1);assert.equal(second.classified.evaluation?.calls,0)
  const packet=buildAssessmentPacket({collectionRunId:collection.runId,position:positions[0],stacks:campaign.stacks,rules})
  assert.equal(packet.status,'ready');if(packet.status==='ready')assert.deepEqual(packet.packet.requirements.stacks.map(s=>s.id),['stack-7'])
  const pending=await classifyWithReuse({collection,rules,policy:'test',cache:{}})
  assert.deepEqual(pending.classified.groups['stack-7'].reviewIds,['0']);assert.deepEqual(pending.classified.groups['stack-2'].reviewIds,[])
  assertClassificationIntegrity(pending.classified)
})

test('title precheck rejects only configured high-confidence cases and is safe for unknown stacks', async () => {
  const rules = await loadSelectionRules(), known = createTitlePrecheck(rules, scope())
  for (const title of ['Junior Java Developer', 'Software Engineer Intern', 'Principal Backend Engineer', 'Engineering Manager, Platform Engineering', 'Backend Engineering Tech Lead', 'Frontend Engineering Team Lead', 'Backend Software Engineer Team Lead', 'Lead QA Engineer', 'Platform Engineering Tech Lead, Cloud – Infra', 'Senior Account Executive', 'TECHNICAL SUPPORT SPECIALIST', 'Database Administrator', 'Office & Facilities Manager']) assert.equal(known.evaluate(title).decision, 'excluded', title)
  for (const title of ['Software Engineer', 'Backend Engineer', 'Python / Go / Java Engineer']) assert.equal(known.evaluate(title).decision, 'continue', title)
  for (const title of ['View role','Next']) {assert.equal(known.evaluate(title,'navigation').decision,'continue');assert.equal(known.evaluate(title).decision,'excluded')}
  for (const title of ['Senior Backend Engineer (mentoring junior engineers)', 'Software Engineer — work with team lead', 'Junior / Senior Backend Engineer', 'Junior/Middle/Senior Software Engineer', 'Software Engineer – account management']) assert.equal(known.evaluate(title).decision, 'continue', title)
  const future = createTitlePrecheck(rules, scope(['2', '99']))
  assert.equal(future.evaluate('QA Engineer').decision, 'excluded')
  assert.equal(future.evaluate('Junior Software Engineer').decision, 'excluded')
  const changedDescription=scope();changedDescription.stacks[0].description='Changed stack contract'
  assert.notEqual(createTitlePrecheck(rules,changedDescription).scopeHash,known.scopeHash)
})

test('publication configuration is optional but malformed present configuration fails closed',async()=>{
  const current=await loadSelectionRules(),without=current.text.replace(/```publication-date-precheck-json[\s\S]*?```/,'').trim(),hash=(text:string)=>createHash('sha256').update(text).digest('hex')
  assert.equal(createTitlePrecheck({...current,text:without,sha256:hash(without)},scope()).publication,undefined)
  const malformed=without+'\n\n```publication-date-precheck-json\n{"version":1,"maxAgeUtcDays":"bad"}\n```'
  assert.throws(()=>createTitlePrecheck({...current,text:malformed,sha256:hash(malformed)},scope()),/publication_date_precheck_configuration_invalid/)
})

test('listing rejects do not open detail pages while ambiguous roles and pagination controls continue', async () => {
  const precheck = createTitlePrecheck(await loadSelectionRules(), scope()), reads:string[] = []
  const junior = job('Junior Java Developer', 'junior'), ambiguous = job('Backend Engineer', 'backend')
  const strategy = createWebsiteStrategy({ titlePrecheck: precheck, maxPages: 8, reader: { read: async url => {
    reads.push(url)
    if (url === source.url) return { url, text: 'Jobs', jobs: [junior, ambiguous], links: [
      { text: junior.title, url: junior.url }, { text: 'View role', url: ambiguous.url }, { text: 'Next', url: `${source.url}?page=2` },
      { text: 'Junior roles', url: `${source.url}?level=junior` }, { text: 'Team leads', url: `${source.url}?department=leads` },
    ] }
    if (url === ambiguous.url) return { url, text: 'Backend Engineer details', jobs: [job(ambiguous.title, 'backend', 'Build and operate reliable backend services with a product engineering team.')], links: [] }
    return { url, text: 'No current positions', jobs: [], links: [], explicitlyEmpty: true }
  } } })
  const result = await strategy.discover([source])
  assert(!reads.includes(junior.url))
  assert(reads.includes(ambiguous.url)); assert(reads.includes(`${source.url}?page=2`))
  assert(reads.includes(`${source.url}?level=junior`)); assert(reads.includes(`${source.url}?department=leads`))
  assert.deepEqual(result.positions.map(p => p.title), ['Backend Engineer'])
  assert.deepEqual(result.audit[0].titlePrecheck?.skipped.map(s => [s.title, s.url, s.ruleId]), [[junior.title, junior.url, 'advertised_level_below_middle']])
})

test('complete ATS feeds omit rejected rows downstream but retain compact title evidence', async () => {
  const precheck = createTitlePrecheck(await loadSelectionRules(), scope())
  const result = await createWebsiteStrategy({ titlePrecheck: precheck, reader: { read: async url => ({
    url, text: 'Complete ATS feed', completeListing: true, links: [], jobs: [
      job('Senior Java Developer', 'senior', 'Build reliable Java services and own production delivery with the engineering team.'),
      job('Support Engineer', 'support', 'Help customers resolve incidents and troubleshoot their support requests.'),
    ],
  }) } }).discover([source])
  assert.deepEqual(result.positions.map(p => p.title), ['Senior Java Developer'])
  assert.equal(result.audit[0].status, 'complete')
  assert.deepEqual(result.audit[0].titlePrecheck?.skipped.map(({title,url,reason,policyHash}) => ({title,url,reason,policyHash})), [{
    title: 'Support Engineer', url: `${source.url}/support`, reason: 'The advertised title is outside the configured role families.', policyHash: precheck.policyHash,
  }])
})

test('a completely traversed listing with only rejected titles remains scoped complete', async () => {
  const precheck=createTitlePrecheck(await loadSelectionRules(),scope())
  const result=await createWebsiteStrategy({titlePrecheck:precheck,reader:{read:async url=>({url,text:'Complete ATS feed',completeListing:true,links:[],jobs:[job('Junior Java Developer','junior'),job('Support Engineer','support')]})}}).discover([source])
  assert.equal(result.positions.length,0);assert.equal(result.audit[0].status,'complete')
  assert.equal(result.audit[0].titlePrecheck?.skipped.length,2)
  assert(!result.audit[0].issues.some(issue=>issue.includes('No vacancy details confirmed')))
})

test('link-only rejected roles are not read and pagination still proves scoped completeness', async () => {
  const precheck=createTitlePrecheck(await loadSelectionRules(),scope()),reads:string[]=[]
  const result=await createWebsiteStrategy({titlePrecheck:precheck,maxPages:4,reader:{read:async url=>{reads.push(url);return url===source.url
    ?{url,text:'Jobs',jobs:[],links:[{text:'Junior Java Developer',url:`${source.url}/junior`},{text:'Support Engineer',url:`${source.url}/support`},{text:'Sales Engineer',url:`${source.url}/sales`},{text:'Next',url:`${source.url}?page=2`}]}
    :{url,text:'No current positions',jobs:[],links:[],explicitlyEmpty:true}}}}).discover([source])
  assert(!reads.includes(`${source.url}/junior`));assert(!reads.includes(`${source.url}/support`));assert(!reads.includes(`${source.url}/sales`));assert(reads.includes(`${source.url}?page=2`))
  assert.equal(result.audit[0].status,'complete');assert.equal(result.audit[0].titlePrecheck?.skipped.length,3)
})

test('legacy all-vacancy snapshots are filtered on reuse, while changed precheck scope forces a fresh source read', async () => {
  const rules = await loadSelectionRules(), current = createTitlePrecheck(rules, scope()), oldCollection:any = {
    version: 1, runId: 'old', sources: [source], scope: scope(), createdAt: '2026-09-28T00:00:00.000Z',
    positions: titlePrecheckPositions([job('Junior Java Developer', 'junior', 'A full body that must not flow into the new collection.'), job('Backend Engineer', 'backend', 'Responsibilities include building and operating reliable backend services, production APIs, monitoring and delivery with the engineering team.')].map((p:any) => ({...p,id:p.url,retrievedAt:'2026-09-28T00:00:00.000Z',source})), current).positions,
    audit: [{ source, status: 'complete', pages: [source.url], found: 2, issues: [] }],
  }
  // Simulate a legacy snapshot that still contains both rows.
  oldCollection.positions.push({...job('Junior Java Developer', 'junior', 'Legacy excluded body.'),id:`${source.url}/junior`,retrievedAt:'2026-09-28T00:00:00.000Z',source})
  const memory:any = { ...emptyMemory(), state: { snapshot: { runId: 'old', configHash: sourceConfigHash(source), status: 'complete', searchedAt: '2026-09-28T00:00:00.000Z' } } }
  const reused = await scanCollection({ runId: 'reuse', sources: [source], scope: scope(), titlePrecheck: current, force: false, maxPages: 4, memories: new Map([['1', memory]]) }, {
    reader: { read: async () => { throw Error('must not read legacy complete snapshot') } }, loadRun: async () => oldCollection, action: async () => {},
  })
  assert.deepEqual(reused.positions.map(p => p.title), ['Backend Engineer'])
  assert.equal(reused.audit[0].titlePrecheck?.skipped[0].title, 'Junior Java Developer')
  const exactMemory:any={...emptyMemory(),state:{snapshot:{runId:'reuse',configHash:sourceConfigHash(source,current.scopeHash),status:'complete',searchedAt:'2026-09-28T00:00:00.000Z'}}}
  assert.equal(reusableSearch(source,exactMemory,Date.parse('2026-09-29T00:00:00.000Z'),false,current.scopeHash),true)
  assert.equal(reusableSearch(source,exactMemory,Date.now(),false,current.scopeHash),true)
  const reusedAgain=await scanCollection({runId:'reuse-again',sources:[source],scope:scope(),titlePrecheck:current,force:false,maxPages:4,memories:new Map([['1',exactMemory]])},{reader:{read:async()=>{throw Error('must not read exact snapshot')}},loadRun:async()=>reused,action:async()=>{}})
  assert.equal(reusedAgain.audit[0].trace?.mode,'reused')
  assert.equal(reusedAgain.audit[0].titlePrecheck?.skipped[0].title,'Junior Java Developer')

  const changedRules = {...rules, sha256: 'changed-policy-hash'}, changed = {...current, policyHash: changedRules.sha256, scopeHash: 'changed-scope'}
  const reads:string[] = []
  memory.state.snapshot.configHash = sourceConfigHash(source, current.scopeHash)
  const fresh = await scanCollection({ runId: 'fresh', sources: [source], scope: scope(), titlePrecheck: changed, force: false, maxPages: 4, memories: new Map([['1', memory]]) }, {
    reader: { read: async url => { reads.push(url); return {url,text:'No current positions',jobs:[],links:[],explicitlyEmpty:true} } }, loadRun: async () => oldCollection, action: async () => {},
  })
  assert(reads.includes(source.url));assert(!reads.includes(`${source.url}/junior`)); assert.equal(fresh.positions.length, 0)
})

test('title-filtered replay never rebuilds a complete ATS response from accepted-only positions', async () => {
  const precheck=createTitlePrecheck(await loadSelectionRules(),scope())
  const memory:any={...emptyMemory(),state:{snapshot:{runId:'old',configHash:sourceConfigHash(source,precheck.scopeHash),status:'complete',searchedAt:'2026-09-28T00:00:00.000Z'},validator:{url:source.url,http:{endpoint:source.url,etag:'fixture'}}}}
  let previous:any='unset'
  await executeSource({source,memory,maxPages:2,titlePrecheck:precheck,previousPositions:[]},{reader:{read:async(url,options)=>{previous=options?.previous;return {url,text:'No current positions',jobs:[],links:[],explicitlyEmpty:true}}},action:async()=>{}})
  assert.equal(previous,undefined)
})
