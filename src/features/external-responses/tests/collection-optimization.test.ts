import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSelectionRules, semanticRules } from '../stack_classification/rules.ts'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { createTitlePrecheck } from '../vacancy_collection/title-precheck.ts'
import { createWebsiteStrategy } from '../vacancy_collection/discover.ts'
import { evaluatePublicationDate } from '../vacancy_collection/publication-date-precheck.ts'
import { classifyWithReuse, decisionKey } from '../stack_classification/reuse.ts'
import { buildAssessmentPacket } from '../stack_classification/session-packet.ts'
import { focusedInvestigation } from '../vacancy_collection/session-reasoner.ts'
import { emptyCompanyFailureGate, recordCompanyDiagnosis, recordCompanyOutcome } from '../benchmark/company-failure-gate.ts'
import { openBenchmarkCheckpoint } from '../benchmark/checkpoint.ts'

const rules=()=>loadSelectionRules()
const source={name:'Fixture',url:'https://fixture.test/careers',database:{sourceId:'1',companyId:'1',applicationRoute:'standard_workflow' as const}}
const scope=()=>buildCampaignScope({database:'fixture',capturedAt:'2026-09-29T00:00:00Z',stacks:[{id:'2',name:'Python',description:'Python backend'},{id:'5',name:'Java',description:'Java backend'},{id:'7',name:'Go',description:'Go backend'}],students:[{studentId:'1',stackId:'2'},{studentId:'2',stackId:'5'},{studentId:'3',stackId:'7'}]})
const position=(publishedAt?:string)=>({id:'p',company:'Fixture',title:'Senior Python Engineer',description:'Build reliable production Python backend services and APIs with PostgreSQL. Own delivery and write developer tests.',location:'Worldwide remote',url:'https://fixture.test/jobs/p',applyUrl:'https://fixture.test/jobs/p',retrievedAt:'2026-09-29T12:00:00Z',source,...(publishedAt?{publishedAt}:{})})

test('strict publication eligibility covers day 14/15/16, missing, impossible, future and conflicts',async()=>{
  const policy=await rules(),now=new Date('2026-09-29T12:00:00Z')
  assert.equal(evaluatePublicationDate(position('2026-09-15'),policy,now).decision,'continue')
  assert.equal(evaluatePublicationDate(position('2026-09-14'),policy,now).decision,'continue')
  assert.equal(evaluatePublicationDate(position('2026-09-13'),policy,now).decision,'excluded')
  assert.equal(evaluatePublicationDate(position(),policy,now).status,'missing')
  assert.equal(evaluatePublicationDate(position('2026-02-30'),policy,now).status,'invalid')
  assert.equal(evaluatePublicationDate(position('2026-09-30'),policy,now).status,'future')
  assert.equal(evaluatePublicationDate({...position('2026-09-28'),publicationLabels:['Posted 3 Days Ago']},policy,now).status,'contradictory')
  assert.equal(evaluatePublicationDate({...position(),publicationLabels:['Posted 15 Days Ago']},policy,now).decision,'continue')
})

test('reliable expired listing dates skip detail reads and keep compact URL/date audit; invalid dates inspect then review',async()=>{
  const policy=await rules(),precheck=createTitlePrecheck(policy,scope()),reads:string[]=[],old={...position('2026-09-13'),id:'old',url:'https://fixture.test/jobs/old',applyUrl:'https://fixture.test/jobs/old'},invalid={...position('2026-02-30'),id:'bad',url:'https://fixture.test/jobs/bad',applyUrl:'https://fixture.test/jobs/bad'}
  const evaluate=precheck.publication!.evaluate
  precheck.publication!.evaluate=position=>evaluate(position,new Date('2026-09-29T12:00:00Z'))
  const result=await createWebsiteStrategy({titlePrecheck:precheck,maxPages:5,reader:{read:async url=>{reads.push(url);if(url===source.url)return {url,fetchedAt:'2026-09-29T12:00:00Z',text:'Jobs',jobs:[old,invalid],links:[{text:old.title,url:old.url},{text:invalid.title,url:invalid.url}]};return {url,fetchedAt:'2026-09-29T12:00:00Z',text:'Detail',links:[],jobs:[{...invalid,description:position().description}]}}}}).discover([source])
  assert(!reads.includes(old.url));assert(reads.includes(invalid.url));assert.equal(result.positions.length,1)
  const outcomes=result.audit[0].publicationDatePrecheck!.outcomes
  assert.ok(outcomes.some(item=>item.url===old.url&&item.decision==='excluded'&&item.publicationDate==='2026-09-13'&&item.asOfDate==='2026-09-29'))
  assert.ok(outcomes.some(item=>item.url===invalid.url&&item.decision==='inspect'&&item.evidence.includes('2026-02-30')))
})

test('semantic cache survives UTC day advance, expiry composes on hit, and exact semantic changes invalidate',async()=>{
  const policy=await rules(),p=position('2026-09-14'),collection:any={version:1,runId:'r',sources:[source],positions:[p],audit:[{source,status:'complete',terminal:true,pages:[source.url],found:1,issues:[]}],createdAt:'2026-09-28T00:00:00Z',scope:scope()}
  const d={decision:'eligible' as const,reasons:['Fixture semantic pass'],evidence:['Build reliable production Python backend services']},assess=async(_p:any,stacks:any[])=>({global:d,stacks:Object.fromEntries(stacks.map(s=>[s.id,d]))})
  const first=await classifyWithReuse({collection,rules:policy,cache:{},policy:'semantic-policy'},{assess,now:()=>new Date('2026-09-29T12:00:00Z')})
  let secondCalls=0
  const second=await classifyWithReuse({collection:{...collection,runId:'r2'},rules:policy,cache:first.updates,policy:'semantic-policy'},{assess:async()=>{secondCalls++;throw Error('must not assess expired')},now:()=>new Date('2026-09-30T12:00:00Z')})
  assert.equal(second.classified.evaluation?.hits,0);assert.equal(secondCalls,0);assert.equal(second.classified.globalDecisions?.p.decision,'excluded');assert.deepEqual(second.updates,{})
  assert.equal(decisionKey(p,scope().stacks,policy,'semantic-policy',new Date('2026-09-29')),decisionKey(p,scope().stacks,policy,'semantic-policy',new Date('2026-09-30')))
  for(const changed of [{...p,location:'US only'},{...p,description:p.description+' Changed body'},{...p,market:{value:'global' as const,language:'en' as const,evidence:['English']}}])assert.notEqual(decisionKey(p,scope().stacks,policy,'semantic-policy'),decisionKey(changed,scope().stacks,policy,'semantic-policy'))
  const old:any={...first.updates.p,cacheVersion:undefined,assessment:first.updates.p.semanticAssessment,semanticAssessment:undefined}
  const ignored=await classifyWithReuse({collection,rules:policy,cache:{p:old},policy:'semantic-policy'})
  assert.equal(ignored.classified.evaluation?.hits,0)
})

test('assessment packets keep full description, rules and routed stacks; expansion happens once and oversize is pending',async()=>{
  const policy=await rules(),p=position(),initial=buildAssessmentPacket({collectionRunId:'r',position:p,stacks:scope().stacks,rules:policy})
  assert.equal(initial.status,'ready');if(initial.status==='ready'){assert.equal(initial.packet.vacancy.description,p.description);assert.equal(initial.packet.requirements.selectionRules,semanticRules(policy));assert.deepEqual(initial.packet.requirements.stacks.map(s=>s.id),['stack-2']);assert.ok(initial.bytes<=64*1024)}
  const large={...p,description:'x'.repeat(70*1024)},needs=buildAssessmentPacket({collectionRunId:'r',position:large,stacks:scope().stacks,rules:policy})
  assert.deepEqual(needs.status==='pending'&&needs.reason,'assessment_packet_expansion_required')
  const expanded=buildAssessmentPacket({collectionRunId:'r',position:large,stacks:scope().stacks,rules:policy,expanded:true});assert.equal(expanded.status,'ready')
  const huge=buildAssessmentPacket({collectionRunId:'r',position:{...p,description:'x'.repeat(140*1024)},stacks:scope().stacks,rules:policy,expanded:true});assert.deepEqual(huge.status==='pending'&&huge.reason,'assessment_packet_too_large')
})

test('investigation packet is bounded and references full local evidence by exact hash',()=>{
  const page:any={url:source.url,text:'x'.repeat(100000),links:Array.from({length:300},(_,i)=>({text:'Job '+i,url:`https://fixture.test/jobs/${i}`})),jobs:[],evidenceRef:'C:/fixture/pages/a.json',evidenceHash:'a'.repeat(64)}
  const audit:any={source,status:'partial',terminal:true,pages:[source.url],found:0,issues:['dynamic'],trace:{mode:'fresh',actions:[],startedAt:'2026-09-29T00:00:00Z',finishedAt:'2026-09-29T00:00:01Z',requests:1}}
  const request=focusedInvestigation({runId:'r',source,audit,remainingReads:199,remainingMs:899000,attempt:1},[page])
  assert.ok(Buffer.byteLength(JSON.stringify(request))<=32*1024);assert.equal(request.observations[0].evidenceRef,page.evidenceRef);assert.equal(request.observations[0].evidenceHash,page.evidenceHash)
  const expanded=focusedInvestigation({runId:'r',source,audit,remainingReads:199,remainingMs:899000,attempt:2},[page],true);assert.ok(Buffer.byteLength(JSON.stringify(expanded))<=64*1024)
})

const failure=(id:string)=>({companyId:id,sources:[{sourceId:id,status:'partial' as const,terminal:true,repairAttempted:true,repairSucceeded:true}],unsupportedSources:0})
test('company failure gate counts companies once, retains repaired streak, resets only on clean company, and hard-stops third failure',()=>{
  let state=emptyCompanyFailureGate(),step=recordCompanyOutcome(state,failure('1'));assert.equal(step.action,'pause_for_diagnosis');state=recordCompanyDiagnosis(step.state,'1',true).state
  step=recordCompanyOutcome(state,failure('2'));state=recordCompanyDiagnosis(step.state,'2',true).state
  step=recordCompanyOutcome(state,failure('3'));assert.equal(step.action,'hard_stop');assert.equal(step.state.consecutiveFailures,3);assert.equal(step.state.hardStopped,true)
  let reset=recordCompanyOutcome(emptyCompanyFailureGate(),failure('1'));state=recordCompanyDiagnosis(reset.state,'1',true).state
  reset=recordCompanyOutcome(state,{companyId:'2',sources:[{sourceId:'a',status:'complete',terminal:true,verifiedEmpty:true},{sourceId:'b',status:'complete',terminal:true}],unsupportedSources:0,matchedVacancies:0});assert.equal(reset.state.consecutiveFailures,0)
  const unsupported=recordCompanyOutcome(emptyCompanyFailureGate(),{companyId:'u',sources:[],unsupportedSources:1});assert.equal(unsupported.action,'pause_for_diagnosis')
  assert.equal(recordCompanyOutcome(emptyCompanyFailureGate(),{...failure('fixture'),kind:'fixture'}).action,'ignored_fixture')
  assert.equal(recordCompanyOutcome(emptyCompanyFailureGate(),failure('q'),'hard_stopped').action,'quota_stop')
})

test('benchmark source budgets persist across resume and a hard stop cannot be erased',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'benchmark-checkpoint-')),path=join(directory,'state.json'),configuration={scope:'frozen'}
  try {
    const first=await openBenchmarkCheckpoint({path,campaignId:'fixture',mode:'cold',configuration,resume:false})
    await first.consumeSourceBudget('s1',{reads:120,activeMs:400000,engineCandidates:1})
    const resumed=await openBenchmarkCheckpoint({path,campaignId:'fixture',mode:'cold',configuration,resume:true})
    assert.deepEqual(resumed.get().sourceBudgets.s1,{reads:120,activeMs:400000,engineCandidates:1})
    await resumed.consumeSourceBudget('s1',{reads:80,activeMs:500000,engineCandidates:1})
    await assert.rejects(resumed.consumeSourceBudget('s1',{reads:1}),/budget_exhausted/)
    await assert.rejects(resumed.consumeSourceBudget('s1',{activeMs:-1}),/delta_invalid/)
    const lowered=resumed.get();lowered.sourceBudgets.s1.reads--
    await assert.rejects(resumed.replace(lowered),/not_monotonic/)
    const stopped=resumed.get();stopped.failureGate.hardStopped=true;stopped.status='hard_stopped';await resumed.replace(stopped)
    const erased=resumed.get();erased.failureGate.hardStopped=false;erased.status='running'
    await assert.rejects(resumed.replace(erased),/cannot_be_erased/)
  } finally {await rm(directory,{recursive:true,force:true})}
})
