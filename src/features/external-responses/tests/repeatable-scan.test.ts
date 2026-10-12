import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceConfigHash, reusableSearch, deferredInvestigation } from '../vacancy_collection/source-memory.ts'
import { validateSourceDescriptions } from '../vacancy_collection/source-quality.ts'
import { decisionKey, validateAssessment } from '../stack_classification/reuse.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'
import { executeSource } from '../vacancy_collection/recipe.ts'
import { scanCollection } from '../vacancy_collection/scan.ts'
import { emptyMemory } from '../vacancy_collection/source-memory.ts'
import { classifyWithReuse } from '../stack_classification/reuse.ts'
import { createCombinedAssessor, combinedPrompt } from '../stack_classification/combined-ai.ts'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { workflowFixture } from '../../company-client-management/tests/runtime-fixture.mts'
import { writeTransaction } from '../../../integrations/postgres/working-session.mts'
import { createReadSession } from '../../../integrations/postgres/read-session.mts'
import { migrateSourceMemory,sourceMemoryChecksum,loadSourceMemory,saveSourceMemory } from '../vacancy_collection/memory-postgres.ts'
import { loadDatabaseSources } from '../company_sources/postgres.ts'
import { saveCollection,loadCollection } from '../vacancy_collection/postgres.ts'
import { saveClassification } from '../stack_classification/postgres.ts'
import { readAts } from '../vacancy_collection/ats-reader.ts'
import { postingContent, publicationContext } from '../vacancy_collection/posting-content.ts'
import { seedReviewedCache } from '../stack_classification/reuse.ts'
import { classifyVacancies } from '../stack_classification/index.ts'

const source = { name: 'Example', url: 'https://example.test/careers', database: { sourceId: '1', companyId: '1', applicationRoute: 'standard_workflow' as const } }
const dateRules=()=>loadSelectionRules()
test('publication evidence stays outside the semantic cache key while substantive and metadata changes invalidate it',async()=>{
  const rules=await dateRules(),stacks=scope().stacks
  const first:any={...job(),id:'fixture',source,description:'Senior Engineer\nPosted 2 Days Ago\nSalary $4000/month\nMust deliver in 3 days. Python required.',market:{value:'global',language:'en',evidence:['Posted 2 Days Ago']}}
  const next={...first,description:first.description.replace('Posted 2 Days Ago','Posted 3 Days Ago')}
  assert.equal(decisionKey(first,stacks,rules,'policy'),decisionKey(next,stacks,rules,'policy'))
  assert.deepEqual(postingContent(first.description).publicationLabels,['Posted 2 Days Ago'])
  assert.match(postingContent(first.description).description,/Must deliver in 3 days/)
  for(const edit of ['Salary $2000/month','Django required.','Must deliver in 4 days.'])assert.notEqual(decisionKey(first,stacks,rules,'policy'),decisionKey({...first,description:first.description+'\n'+edit},stacks,rules,'policy'))
  assert.match(postingContent('Posted 3 days ago; Python required').description,/Python required/)
})

test('changed publication evidence reuses the separate semantic reviewed decision',async()=>{
  const rules=await loadSelectionRules(),collection=await scanCollection({runId:'old-review',sources:[source],scope:scope(),force:true,maxPages:2,memories:new Map([['1',emptyMemory()]])},{reader:{read:async()=>({url:source.url,text:'Jobs',links:[],jobs:[job()]})},loadRun:async()=>{throw Error('none')},action:async()=>{}})
  collection.positions[0].description+='\nPosted 2 Days Ago'
  const d={decision:'excluded' as const,reasons:['Outside scope'],evidence:['Senior Python Engineer']}
  const before=await classifyVacancies({collection,selectionRules:rules,assessmentCacheVersion:'semantic-v1',assessmentProvenance:{origin:'assistant_session',reviewedBy:'fixture',reviewedAt:new Date().toISOString(),reviewHash:'fixture'}},{assessGlobal:async()=>({...d,decision:'eligible'}),assess:async()=>d})
  const seed=seedReviewedCache(before,rules,collection.scope!.stacks),after=structuredClone(collection)
  after.runId='new-review';after.positions[0].description=after.positions[0].description.replace('Posted 2 Days Ago','Posted 3 Days Ago')
  const id=after.positions[0].id
  const result=await classifyWithReuse({collection:after,rules,cache:{[id]:{...seed[id],key:'old-format'}},fallbackCache:seed,policy:'reviewed-v1'})
  assert.equal(result.classified.evaluation?.hits,1)
  assert.equal(result.classified.evaluation?.pendingIds.length,0)
  assert.equal(result.classified.evaluation?.records[id].origin,'assistant_session')
  assert.equal(new Set(Object.values(result.classified.groups).flatMap((g:any)=>g.matchedIds)).size,0)
})
test('dated eligibility ages across days without changing the semantic key, and metadata is valid evidence',async()=>{
  const rules=await dateRules(),stacks=scope().stacks
  const position:any={...job(),id:'dated',source,retrievedAt:'2026-09-27T10:00:00Z',publishedAt:'2026-09-13'}
  const at15=new Date('2026-09-28T12:00:00Z'),at16=new Date('2026-09-29T12:00:00Z')
  assert.equal(publicationContext(position,at15).ageDays,15)
  assert.equal(publicationContext(position,at16).ageDays,16)
  assert.equal(decisionKey(position,stacks,rules,'p',at15),decisionKey(position,stacks,rules,'p',at16))
  const undated={...position,publishedAt:undefined}
  assert.equal(decisionKey(undated,stacks,rules,'p',at15),decisionKey(undated,stacks,rules,'p',at16))
  assert.equal(publicationContext(undated,at16).ageDays,undefined)
  const relative={...undated,publicationLabels:['Posted 14 Days Ago']}
  assert.equal(publicationContext(relative,at15).ageDays,15)
  assert.equal(publicationContext(relative,at16).ageDays,16)
  validateAssessment({global:{decision:'excluded',reasons:['Publication is outside allowed age'],evidence:['2026-09-13']},stacks:{}},position,stacks)
})
test('weekly snapshot reuses semantic assessment but reapplies current date eligibility',async()=>{
  const rules=await dateRules(),collection=await scanCollection({runId:'aged',sources:[source],scope:scope(),force:true,maxPages:2,memories:new Map([['1',emptyMemory()]])},{reader:{read:async()=>({url:source.url,text:'Jobs',links:[],jobs:[{...job(),publishedAt:'2026-09-13'}]})},loadRun:async()=>{throw Error('none')},action:async()=>{}})
  const at15=new Date('2026-09-28T12:00:00Z'),at16=new Date('2026-09-29T12:00:00Z')
  const d={decision:'eligible' as const,reasons:['Fixture review'],evidence:['Senior Python Engineer']}
  const reviewed=await classifyVacancies({collection,selectionRules:rules,assessmentCacheVersion:'semantic-v1',assessmentProvenance:{origin:'assistant_session',reviewedBy:'fixture',reviewedAt:at15.toISOString(),reviewHash:'fixture'},now:at15},{assessGlobal:async()=>d,assess:async()=>d})
  const cache=seedReviewedCache(reviewed,rules,collection.scope!.stacks)
  const composed=await classifyVacancies({collection,selectionRules:rules,assessmentCacheVersion:'semantic-v1',assessmentProvenance:{origin:'assistant_session',reviewedBy:'fixture',reviewedAt:at16.toISOString(),reviewHash:'fixture-expired'},now:at16},{assessGlobal:async()=>d,assess:async()=>d})
  assert.deepEqual(seedReviewedCache(composed,rules,collection.scope!.stacks),{})
  const sameDay=await classifyWithReuse({collection,rules,cache,policy:'reviewed-v1'},{now:()=>at15})
  assert.equal(sameDay.classified.evaluation?.hits,1)
  const nextDay=await classifyWithReuse({collection,rules,cache,policy:'reviewed-v1'},{now:()=>at16})
  assert.equal(nextDay.classified.evaluation?.hits,0)
  assert.equal(nextDay.classified.evaluation?.pendingIds.length,0)
  assert.equal(nextDay.classified.globalDecisions?.[collection.positions[0].id].decision,'excluded')
})
test('complete public ATS responses reuse HTTP validators; an unbound 304 or malformed list cannot mean empty', async()=>{
  const url='https://jobs.ashbyhq.com/example'
  const previous=await readAts(url,async()=>new Response(JSON.stringify({jobs:[{title:'Senior Engineer',location:'Remote',descriptionPlain:'Build production services.',jobUrl:url+'/one',publishedAt:'2026-09-13T00:00:00Z'}]}),{headers:{etag:'"fixture-1"'}}))
  assert.equal(previous?.jobs[0].publishedAt,'2026-09-13T00:00:00Z')
  assert.equal(previous?.httpValidator?.etag,'"fixture-1"')
  const next=await readAts(url,async(_u,init)=>{assert.equal(new Headers(init?.headers).get('if-none-match'),'"fixture-1"');return new Response(null,{status:304})},previous)
  assert.deepEqual(next?.jobs,previous?.jobs)
  await assert.rejects(readAts(url,async()=>new Response(null,{status:304})),/without a validated/)
  await assert.rejects(readAts('https://example.recruitee.com',async()=>new Response('{}')),/validated offers/)
})
test('a fuller detail page cannot discard the listing publication date',async()=>{
  const posting=job()
  const result=await scanCollection({runId:'dated-detail',sources:[source],scope:scope(),force:true,maxPages:2,memories:new Map([['1',emptyMemory()]])},{reader:{read:async url=>({url,text:'Jobs',links:url===source.url?[{url:posting.url,text:posting.title}]:[],jobs:[url===source.url?{...posting,description:'Short listing description',publishedAt:'2026-09-13'}:posting]})},loadRun:async()=>{throw Error('none')},action:async()=>{}})
  assert.equal(result.positions[0].description,posting.description)
  assert.equal(result.positions[0].publishedAt,'2026-09-13')
  assert.equal(result.audit[0].status,'complete')
})
test('weekly reuse requires compatible complete evidence, never a partial or pending source', () => {
  const now = Date.parse('2026-09-28T12:00:00Z'), at = '2026-09-25T12:00:00Z'
  const memory: any = { state: { snapshot: { runId: 'old', configHash: sourceConfigHash(source), status: 'complete', searchedAt: at } }, lastComplete: at }
  assert.equal(reusableSearch(source, memory, now, false), true)
  assert.equal(reusableSearch(source, memory, now, true), false)
  assert.equal(reusableSearch(source, memory, now + 7 * 86400000, false), false)
  assert.equal(reusableSearch({ ...source, url: 'https://example.test/new' }, memory, now, false), false)
  assert.equal(reusableSearch(source, { ...memory, state: { ...memory.state, review: { status: 'pending' } } }, now, false), false)
  assert.equal(reusableSearch(source, { ...memory, state: { snapshot: { ...memory.state.snapshot, status: 'partial' } } }, now, false), false)
  assert.equal(memory.lastComplete, at)
})

const scope=()=>buildCampaignScope({database:'unicorn_noco_copy',stacks:[{id:'2',name:'Python',description:'Python backend'},{id:'3',name:'FullStack',description:'JS frontend'}],students:[{studentId:'1',stackId:'2'},{studentId:'2',stackId:'3'}]})
const job=(s=source)=>({title:'Senior Python Engineer',company:s.name,url:s.url+'/jobs/1',applyUrl:s.url+'/jobs/1',location:'Worldwide',description:'Build Python backend services and deliver reliable production systems with the team. Own complete features and write developer tests.'})

test('deferred investigation retains partial findings without claiming complete freshness; force retries',async()=>{
  const old=await scanCollection({runId:'old',sources:[source],scope:scope(),force:true,maxPages:2,memories:new Map([['1',emptyMemory()]])},{reader:{read:async()=>({url:source.url,text:'Jobs',links:[],jobs:[job()],partial:true})},loadRun:async()=>{throw Error('none')},action:async()=>{}})
  const memory:any={...emptyMemory(),state:{snapshot:{runId:'old',configHash:sourceConfigHash(source),status:'partial',searchedAt:new Date().toISOString()},investigation:{status:'deferred'}}}
  assert.equal(deferredInvestigation(source,memory,Date.now(),false),true)
  assert.equal(deferredInvestigation(source,memory,Date.now(),true),false)
  assert.equal(reusableSearch(source,memory,Date.now(),false),false)
  const reused=await scanCollection({runId:'retain',sources:[source],scope:scope(),force:false,maxPages:2,memories:new Map([['1',memory]])},{reader:{read:async()=>{throw Error('must not read')}},loadRun:async()=>old,action:async()=>{}})
  assert.equal(reused.positions.length,1);assert.equal(reused.audit[0].status,'partial');assert.equal(reused.audit[0].trace?.requests,0)
})

test('historical boilerplate cannot count as complete or promote a verified recipe',()=>{
  const audit:any={source,status:'complete',pages:[source.url],found:1,issues:[],trace:{recipe:{revision:'old'}}}
  const position:any={...job(),source,description:'About us: We are an award-winning company with offices in Europe, offering an exciting work culture. Join us for growth opportunities.'}
  const verified=validateSourceDescriptions([audit],[position])
  assert.equal(verified[0].status,'partial');assert.equal(verified[0].trace?.recipe,undefined)
  assert.equal(audit.status,'complete');assert.equal(audit.trace.recipe.revision,'old')
  assert.match(verified[0].issues[0],/company_boilerplate/)
})

test('explicit source time budget reaches later details without resetting for repair',async t=>{
  let elapsed=0; const base=Date.now()
  t.mock.method(Date,'now',()=>base+elapsed)
  const reads:string[]=[]
  const reader={read:async(url:string)=>{reads.push(url);elapsed=360000;return url===source.url?{url,text:'Jobs',links:[{url:job().url,text:job().title}],jobs:[]}:{url,text:'Details',links:[],jobs:[job()]}}}
  const short=await executeSource({source,memory:emptyMemory(),maxPages:4},{reader,action:async()=>{}})
  assert.equal(short.positions.length,0);assert.equal(short.audit.status,'partial');assert.deepEqual(reads,[source.url]);assert.equal(short.audit.trace?.repaired,false)
  elapsed=0;reads.length=0
  const extended=await executeSource({source,memory:emptyMemory(),maxPages:4,maxSourceMs:900000},{reader,action:async()=>{}})
  assert.equal(extended.positions.length,1);assert.equal(extended.audit.status,'complete');assert.deepEqual(reads,[source.url,job().url])
  await assert.rejects(executeSource({source,memory:emptyMemory(),maxPages:4,maxSourceMs:Infinity},{reader,action:async()=>{}}),/invalid_source_time_budget/)
})
test('recipes record verified controls; changed controls repair once; walls pause without repair', async()=>{
  const actions:any[]=[],board={url:source.url,text:'Jobs',links:[],jobs:[job()],controls:[{operation:'click' as const,role:'button' as const,name:'Show all open positions'}],method:'browser'}
  const first=await executeSource({source,memory:emptyMemory(),maxPages:4},{reader:{read:async()=>board},action:async a=>{actions.push(a)}})
  assert.equal(first.audit.status,'complete');assert.ok(first.audit.trace?.recipe)
  let reads=0
  const replay=await executeSource({source,memory:{...emptyMemory(),recipe:first.audit.trace!.recipe!},maxPages:4},{reader:{read:async(_url,opts)=>{reads++;if(opts?.steps)throw Error('selector changed');return {...board,controls:[]}}},action:async()=>{}})
  assert.equal(reads,2);assert.equal(replay.audit.trace?.repaired,true);assert.ok(replay.audit.trace?.previousRecipe)
  const wall=await executeSource({source,memory:emptyMemory(),maxPages:4},{reader:{read:async()=>({url:source.url,text:'Log in to view jobs',links:[],jobs:[],accessGate:{kind:'login_required',url:source.url,evidence:'Log in'}})},action:async()=>{}})
  assert.equal(wall.audit.trace?.requests,1);assert.equal(wall.audit.trace?.repaired,false)
  const zero=await executeSource({source,memory:emptyMemory(),maxPages:3},{reader:{read:async()=>({url:source.url,text:'No current postings',links:[],jobs:[],explicitlyEmpty:true})},action:async()=>{}})
  assert.equal(zero.audit.status,'complete')
  const broken=await executeSource({source,memory:emptyMemory(),maxPages:2},{reader:{read:async()=>({url:source.url,text:'Empty shell',links:[],jobs:[],partial:true})},action:async()=>{}})
  assert.equal(broken.audit.status,'partial');assert.equal(broken.audit.trace?.requests,1);assert.equal(broken.audit.trace?.recipe,undefined);assert.equal(broken.audit.trace?.repairOutcome,'not_attempted')
})
test('all sources finish with at most three workers; fresh complete scans reuse without any reader calls',async()=>{
  const sources=Array.from({length:5},(_,i)=>({...source,url:`https://example${i}.test/careers`,database:{...source.database,sourceId:String(i+1)}})),memories=new Map(sources.map(s=>[s.database.sourceId,emptyMemory()]))
  let active=0,peak=0,reads=0
  const collection=await scanCollection({runId:'fresh',sources,scope:scope(),force:false,maxPages:4,memories},{reader:{read:async url=>{active++;peak=Math.max(peak,active);reads++;await new Promise(r=>setTimeout(r,3));active--;const s=sources.find(s=>s.url===url)!;return {url,text:'Jobs',links:[],jobs:[job(s)]}}},loadRun:async()=>{throw Error('no previous')},action:async()=>{}})
  assert.equal(collection.audit.length,5);assert.equal(reads,5);assert.equal(peak,3)
  active=0;peak=0
  await scanCollection({runId:'sequential',sources,scope:scope(),force:true,maxPages:4,memories,concurrency:1},{reader:{read:async url=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,3));active--;const s=sources.find(s=>s.url===url)!;return {url,text:'Jobs',links:[],jobs:[job(s)]}}},loadRun:async()=>{throw Error('no previous')},action:async()=>{}})
  assert.equal(peak,1)
  for(const audit of collection.audit)memories.set(audit.source.database!.sourceId,{...emptyMemory(),recipe:audit.trace!.recipe!,state:{snapshot:{runId:'fresh',status:'complete',configHash:sourceConfigHash(audit.source),searchedAt:audit.trace!.finishedAt,recipeRevision:audit.trace!.recipe!.revision}}})
  const reuse=await scanCollection({runId:'reused',sources,scope:scope(),force:false,maxPages:4,memories},{reader:{read:async()=>{throw Error('must not fetch')}},loadRun:async()=>collection,action:async()=>{}})
  assert.equal(reuse.positions.length,5);assert.ok(reuse.audit.every(a=>a.trace?.mode==='reused'&&a.trace.requests===0))
})
test('one combined call assesses routed stacks; other stacks are excluded and exact cache hits avoid calls',async()=>{
  const rules=await loadSelectionRules(),collection=await scanCollection({runId:'decisions',sources:[source],scope:scope(),force:true,maxPages:2,memories:new Map([['1',emptyMemory()]])},{reader:{read:async()=>({url:source.url,text:'Jobs',links:[],jobs:[job()]})},loadRun:async()=>{throw Error('none')},action:async()=>{}})
  const decision={decision:'eligible' as const,reasons:['Supported'],evidence:['Build Python backend services']}
  let calls=0
  const result=await classifyWithReuse({collection,rules,cache:{},policy:'test-policy'},{assess:async(_p,stacks)=>{calls++;return {global:decision,stacks:Object.fromEntries(stacks.map(s=>[s.id,decision]))}}})
  assert.equal(calls,1);assert.equal(result.classified.groups['stack-2'].matchedIds.length,1);assert.equal(result.classified.groups['stack-3'].matchedIds.length,0);assert.equal(result.classified.groups['stack-3'].excludedIds.length,1)
  const again=await classifyWithReuse({collection:{...collection,runId:'next'},rules,cache:result.updates,policy:'test-policy'},{assess:async()=>{throw Error('unexpected call')}})
  assert.equal(again.classified.evaluation?.hits,1);assert.equal(again.classified.evaluation?.calls,0)
  const failed=await classifyWithReuse({collection,rules,cache:{},policy:'test-policy'},{assess:async()=>{throw Error('network')}})
  assert.equal(failed.classified.readyForApplications,false);assert.equal(failed.classified.evaluation?.pendingIds.length,1);assert.deepEqual(failed.updates,{})
  const config={version:1 as const,model:'fixture',promptHash:digest(combinedPrompt),maxInputBytes:65536,maxOutputTokens:2000,maxRequests:1,retries:0 as const,cacheVersion:'semantic-v1' as const,approvedBy:'fixture',approvedAt:new Date().toISOString(),approvalReference:'test only'}
  let payload=''
  const assessor=createCombinedAssessor({respond:async(msg:any[])=>{payload=msg[0].content;return {global:decision,stacks:{'stack-2':decision,'stack-3':decision}}}} as any,{...config,sha256:digest(config)})
  await assessor({...collection.positions[0],publishedAt:'2026-09-13',publicationLabels:['Posted 2 Days Ago']},collection.scope!.stacks,rules)
  assert.equal(JSON.parse(payload).stacks.length,2)
  assert.equal(JSON.parse(payload).vacancy.publication,undefined)
  await assert.rejects(assessor(collection.positions[0],collection.scope!.stacks,rules),/budget/)
})
test('additive SQL memory stores recipes/actions/cache; interrupted run resumes, closure preserves history',async()=>{
  const f=await workflowFixture(),read=createReadSession(f.pool,f.database),write=<T>(fn:any)=>writeTransaction<T>(f.pool,f.database,fn)
  try {
    const db={database:f.database,read,write};await migrateSourceMemory(db,sourceMemoryChecksum);await migrateSourceMemory(db,sourceMemoryChecksum)
    const catalog=await loadDatabaseSources(fn=>read(s=>fn(s,{} as any,{} as any)))
    const only=await loadDatabaseSources(fn=>read(s=>fn(s,{} as any,{} as any)),{companyIds:[catalog.companyIds[0]]})
    assert.deepEqual(only.companyIds,[catalog.companyIds[0]])
    await assert.rejects(loadDatabaseSources(fn=>read(s=>fn(s,{} as any,{} as any)),{companyIds:['999999']}),/unknown/)
    await f.db.exec('INSERT INTO noco.stacks VALUES(2),(3)')
    const sources=only.sources,memories=await loadSourceMemory(sources,read),rules=await loadSelectionRules()
    const collection=await scanCollection({runId:'sql-scan',sources,scope:scope(),force:true,maxPages:4,memories},{reader:{read:async url=>({url,text:'Jobs',jobs:[job(sources[0] as any)],links:[]})},loadRun:async()=>{throw Error('none')},action:async()=>{}})
    collection.scan={status:'interrupted',configHash:'fixed',companies:only.companies,startedAt:new Date().toISOString()}
    await saveCollection(collection,write);assert.equal((await loadCollection(collection.runId,read)).collection.scan?.status,'interrupted')
    collection.scan.status='complete';await saveCollection(collection,write)
    await saveSourceMemory({runId:collection.runId,audits:collection.audit,memories,decisions:{},positionSources:new Map(),collectionOnly:true},write)
    const collectedMemory=await loadSourceMemory(sources,read)
    assert.ok(collectedMemory.get(sources[0].database!.sourceId)!.recipe)
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies')).rows[0].n,0)
    assert.equal((await loadCollection(collection.runId,read)).classification,null)
    await assert.rejects(saveSourceMemory({runId:collection.runId,audits:collection.audit,memories:collectedMemory,decisions:{} as any,positionSources:new Map(),collectionOnly:true,decisionsOnly:true},write),/cannot_save_assessments/)
    for(const [id,memory] of collectedMemory)memories.set(id,memory)
    const d={decision:'eligible' as const,reasons:['Backend'],evidence:['Build Python backend services']}
    const result=await classifyWithReuse({collection,rules,cache:{},policy:'fixture'},{assess:async()=>({global:d,stacks:{'stack-2':d,'stack-3':{...d,decision:'excluded'}}})})
    await saveClassification(result.classified,write)
    await saveSourceMemory({runId:collection.runId,audits:collection.audit,memories,decisions:result.updates,positionSources:new Map(collection.positions.map(p=>[p.id,[sources[0].database!.sourceId]]))},write)
    const after=await loadSourceMemory(sources,read),remembered=after.get(sources[0].database!.sourceId)!
    assert.ok(remembered.recipe);assert.ok(remembered.lastComplete);assert.equal(Object.keys(remembered.state.decisions!).length,1)
    assert.ok((await loadCollection(collection.runId,read)).collection.audit[0].trace?.actions.length)
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies')).rows[0].n,1)
    await assert.rejects(saveCollection({...collection,positions:[]},write),/collection_run_immutable/)
    // Absence in a complete listing alone is insufficient; only the explicit direct-page 410 closes it.
    const second=await scanCollection({runId:'sql-closed',sources,scope:scope(),force:true,maxPages:4,memories:after},{reader:{read:async url=>url===sources[0].url?{url,text:'No current postings',jobs:[],links:[],explicitlyEmpty:true}:{url,text:'Gone',jobs:[],links:[],closedEvidence:'Official URL returned HTTP 410'}},loadRun:async()=>(await loadCollection(collection.runId,read)).collection,action:async()=>{}})
    second.scan={...collection.scan,status:'complete'}
    await saveCollection(second,write)
    const closed=await classifyWithReuse({collection:second,rules,cache:{},policy:'fixture'})
    await saveClassification(closed.classified,write)
    await saveSourceMemory({runId:second.runId,audits:second.audit,memories:after,decisions:{},positionSources:new Map()},write)
    assert.equal((await f.db.query('SELECT availability FROM noco.vacancies')).rows[0].availability,'closed')
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancy_stacks')).rows[0].n,1)
  } finally {await f.db.close()}
})
test('decision keys cover semantic inputs, stack/rule/policy versions, but not observation time or student counts', async () => {
  const rules = await loadSelectionRules(), stacks = [{ id: 'stack-2', name: 'Python', description: 'Python backend' }]
  const p: any = { id: '1', company: 'Example', title: 'Senior Python Engineer', description: 'Responsibilities: build and operate reliable Python backend services and APIs. Requirements: professional production engineering experience and ownership.', source, url: source.url + '/1', applyUrl: source.url + '/1/apply', location: 'Remote' }
  const key = decisionKey(p, stacks, rules, 'policy-1')
  assert.equal(key, decisionKey({ ...p, retrievedAt: 'later' }, stacks, rules, 'policy-1'))
  for (const changed of [{ ...p, description: p.description + ' Django required.' }, { ...p, location: 'Paris' }, { ...p, title: 'Junior Python Engineer' }]) assert.notEqual(key, decisionKey(changed, stacks, rules, 'policy-1'))
  assert.throws(() => decisionKey(p, stacks, { ...rules, sha256: 'changed' }, 'policy-1'), /rules_invalid/)
  assert.notEqual(key, decisionKey(p, [{ ...stacks[0], description: 'Java backend' }], rules, 'policy-1'))
  assert.notEqual(key, decisionKey(p, stacks, rules, 'policy-2'))
  const decision = { decision: 'eligible', reasons: ['Python backend'], evidence: ['build and operate reliable Python backend services'] }
  assert.doesNotThrow(() => validateAssessment({ global: decision, stacks: { 'stack-2': decision } } as any, p, stacks))
  assert.throws(() => validateAssessment({ global: decision, stacks: {} } as any, p, stacks), /assessment/)
  assert.throws(() => validateAssessment({ global: { ...decision, evidence: ['Fabricated'] }, stacks: { 'stack-2': decision } } as any, p, stacks), /assessment/)
})
