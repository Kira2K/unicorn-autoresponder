import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebsiteStrategy } from '../vacancy_collection/discover.ts'
import { readAts } from '../vacancy_collection/ats-reader.ts'
import { executeReasonedSource, groundEngineJobs } from '../vacancy_collection/reasoned-source.ts'
import { emptyMemory } from '../vacancy_collection/source-memory.ts'
import { createSessionReasoner } from '../vacancy_collection/session-reasoner.ts'
import { inspectSource } from '../vacancy_collection/source-inspection.ts'
import { executeSource } from '../vacancy_collection/recipe.ts'
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('restricted individual detail does not suppress other public postings', async () => {
  const source={name:'Fixture',url:'https://fixture.test/careers'}, seen:string[]=[]
  const result=await createWebsiteStrategy({maxPages:10,reader:{read:async url=>{
    seen.push(url)
    if(url===source.url)return {url,text:'Open jobs',jobs:[],links:[{text:'Private Engineer',url:'https://fixture.test/jobs/private'},{text:'Public Engineer',url:'https://fixture.test/jobs/public'}]}
    if(url.endsWith('private'))return {url,text:'Login required',jobs:[],links:[],accessGate:{kind:'login_required',url,evidence:'Sign in to read this posting'}}
    return {url,text:'Public Engineer',links:[],jobs:[{url,applyUrl:url,company:'Fixture',title:'Public Engineer',location:'Europe',description:'Responsibilities: build production Python backend services. Requirements: experienced developer delivering reliable software and distributed services.'}]}
  }}}).discover([source])
  assert.equal(result.positions.length,1)
  assert.equal(result.audit[0].status,'partial')
  assert.equal(result.audit[0].accessGate,undefined)
  assert.ok(seen.some(u=>u.endsWith('/public')))
})

test('historical internal posting login does not pause an entire public board',async()=>{
  const source={name:'Fixture',url:'https://fixture.test/careers'}
  const gate={kind:'login_required' as const,url:'https://fixture.test/wp-login.php?redirect_to=https%3A%2F%2Ffixture.test%2Fjob%2Finternal',evidence:'Log in'}
  const result=await executeSource({source,maxPages:2,memory:{...emptyMemory(),state:{review:{status:'pending',gate}}}},{reader:{read:async url=>({url,text:'No open positions',links:[],jobs:[],explicitlyEmpty:true})},action:async()=>{}})
  assert.equal(result.audit.status,'complete')
  assert.ok(result.audit.trace?.actions.some(a=>a.operation==='individual_posting_gate_preserved'))
  const blocked=await executeSource({source,maxPages:2,memory:{...emptyMemory(),state:{review:{status:'pending',gate:{...gate,url:source.url}}}}},{reader:{read:async()=>{throw Error('Board login must remain paused')}},action:async()=>{}})
  assert.equal(blocked.audit.trace?.mode,'paused')
})

test('Greenhouse first publication is preserved; modification time is not publication',async()=>{
  const read=(extra:object)=>readAts('https://job-boards.greenhouse.io/fixture/jobs/1',async()=>new Response(JSON.stringify({id:1,title:'Engineer',content:'Requirements: build reliable backend production services with an experienced engineering team.',...extra})))
  assert.equal((await read({first_published:'2026-09-02T00:00:00Z',updated_at:'2026-09-28T00:00:00Z'}))?.jobs[0].publishedAt,'2026-09-02T00:00:00Z')
  assert.equal((await read({updated_at:'2026-09-28T00:00:00Z'}))?.jobs[0].publishedAt,undefined)
})

test('generated parsing preserves observed metadata and cannot invent or cross-pair it',()=>{
  const description='Responsibilities: build reliable Python backend services. Requirements: professional production engineering experience and ownership.'
  const url='https://fixture.test/jobs/python-1',applyUrl=url+'/apply'
  const observed={title:'Senior Python Engineer',description,url,applyUrl,location:'Paris, France',publishedAt:'2026-09-28T00:00:00Z',publicationLabels:['Posted 1 day ago']}
  const page:any={url:'https://fixture.test/careers',text:`${observed.title}\n${description}`,links:[{text:observed.title,url},{text:'Apply',url:applyUrl}],jobs:[observed]}
  assert.deepEqual(groundEngineJobs(page,[{title:observed.title,description,url,applyUrl,location:''}]),[observed])
  assert.throws(()=>groundEngineJobs(page,[{...observed,location:'Tbilisi, Georgia'}]),/metadata_or_job_mismatch/)
  assert.throws(()=>groundEngineJobs(page,[{...observed,publishedAt:'2026-09-29T00:00:00Z'}]),/metadata_or_job_mismatch/)
  assert.throws(()=>groundEngineJobs(page,[{...observed,title:'Another observed title'}]),/metadata_or_job_mismatch/)

  const raw={...page,jobs:[]}
  assert.deepEqual(groundEngineJobs(raw,[{title:observed.title,description,url,applyUrl,location:''}]),[{title:observed.title,description,url,applyUrl,location:''}])
  assert.throws(()=>groundEngineJobs(raw,[{title:observed.title,description,url,applyUrl,location:observed.location}]),/not_grounded/)
  assert.throws(()=>groundEngineJobs(raw,[{title:observed.title,description,url,applyUrl,location:'',publishedAt:observed.publishedAt}]),/not_grounded/)
})

test('Codex handoff is bound, resumable and preserves the total source budget',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'collection-repair-'))
  try {
    const source={name:'Fixture',url:'https://fixture.test/careers',database:{companyId:'1',sourceId:'1',applicationRoute:'standard_workflow' as const}}
    const reasoner=createSessionReasoner(directory),seen:string[]=[]
    const reader={read:async(url:string)=>{
      seen.push(url)
      return url.endsWith('/board')?{url,text:'Open roles',links:[],completeListing:true,jobs:[{title:'Senior Python Engineer',company:'Fixture',url:url+'/jobs/1',applyUrl:url+'/jobs/1',location:'Europe',description:'Requirements: develop reliable Python backend systems and services. Responsibilities: own production software and collaborate with product engineering.'}]}:{url,text:'Our careers widget is loading',links:[],jobs:[],partial:true}
    }}
    const input={runId:'fixture',source,memory:emptyMemory(),maxPages:10,maxSourceMs:60000,engineRoot:directory}
    const first=await executeReasonedSource(input,{reader,reasoner,action:async()=>{}})
    assert.equal(first.audit.terminal,false)
    const file=(await readdir(directory)).find(f=>f.endsWith('.request.json'))!,request=JSON.parse(await readFile(join(directory,file),'utf8'))
    const proposal={version:1,requestId:request.id,sourceId:'1',model:'gpt-6-sol',origin:'assistant_session',action:'repair',reason:'Verified official job board',plan:{entryUrls:['https://fixture.test/board']}}
    await writeFile(join(directory,request.id+'.proposal.json'),JSON.stringify({...proposal,sourceId:'2'}))
    await assert.rejects(reasoner.investigate(request),/binding_invalid/)
    await assert.rejects(inspectSource({request,path:join(directory,request.id+'.inspections.json'),url:'https://unrelated.test/careers'},reader),/outside_source/)
    await inspectSource({request,path:join(directory,request.id+'.inspections.json'),url:'https://fixture.test/diagnostics'},reader)
    await writeFile(join(directory,request.id+'.proposal.json'),JSON.stringify(proposal))
    const second=await executeReasonedSource({...input,previousAttempt:first},{reader,reasoner,action:async()=>{}})
    assert.equal(second.audit.status,'complete')
    assert.equal(second.positions.length,1)
    assert.equal(second.audit.trace?.requests,3)
    assert.deepEqual(seen,[source.url,'https://fixture.test/diagnostics','https://fixture.test/board'])
    assert.ok(second.audit.trace?.actions.some(a=>a.operation==='codex_diagnostic_read'))
    assert.equal(second.audit.trace?.recipe?.repairProvenance?.model,'gpt-6-sol')
    const replay=await executeReasonedSource({...input,memory:{...emptyMemory(),recipe:second.audit.trace!.recipe!}},{reader,reasoner:{investigate:async()=>{throw Error('Unchanged recipe must not ask Sol')}},action:async()=>{}})
    assert.equal(replay.audit.status,'complete')
  } finally {await rm(directory,{recursive:true,force:true})}
})

test('missing generated artifact rolls back to the previous verified recipe',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'collection-rollback-'))
  try {
    const source={name:'Fixture',url:'https://fixture.test/careers',database:{companyId:'1',sourceId:'1',applicationRoute:'standard_workflow' as const}}
    const previous={version:1 as const,revision:'previous',verifiedAt:new Date().toISOString(),listingUrls:[source.url],controls:{},methods:['browser'],checks:{substantiveDescriptions:true as const,paginationComplete:true as const},origin:'observed' as const}
    const result=await executeReasonedSource({runId:'rollback',source,maxPages:5,engineRoot:directory,memory:{...emptyMemory(),recipe:{...previous,revision:'broken',engine:{id:'missing-engine',version:1,sha256:'a'.repeat(64),sourceId:'1'},previous}}},{reader:{read:async url=>({url,text:'No open positions',jobs:[],links:[],explicitlyEmpty:true})},action:async()=>{}})
    assert.equal(result.audit.status,'complete')
    assert.ok(result.audit.trace?.actions.some(a=>a.operation==='engine_binding_rollback'))
    assert.equal(result.audit.trace?.recipe?.engine,undefined)
  } finally {await rm(directory,{recursive:true,force:true})}
})
