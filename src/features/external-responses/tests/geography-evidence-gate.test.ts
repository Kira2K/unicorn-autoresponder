import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { loadSelectionRules,decisionRulesHash } from '../stack_classification/rules.ts'
import { createAssessmentPrecheck } from '../stack_classification/precheck.ts'
import { createGeographyPrecheck } from '../stack_classification/geography-precheck.ts'
import { classifyWithReuse,decisionKey,semanticCacheHit,validateAssessment } from '../stack_classification/reuse.ts'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { saveClassification } from '../stack_classification/postgres.ts'
import { assertClassificationIntegrity } from '../stack_classification/index.ts'

const source={name:'Fixture',url:'https://fixture.test/careers'}
const body='Build and operate production Python backend services and APIs. Own deployment, testing and monitoring. Required experience with Python and SQL. Django is optional.'
const position=(location:string,description=body):any=>({id:'p',company:'Fixture',title:'Senior Python Engineer',location,description,url:source.url+'/p',applyUrl:source.url+'/p',source,retrievedAt:new Date().toISOString()})
const scope=buildCampaignScope({database:'fixture',stacks:[{id:'2',name:'Python',description:'Middle/senior Python backend; optional Django is allowed.'}],students:[{studentId:'1',stackId:'2'}]})
const approved=(p:any)=>({global:{decision:'eligible' as const,reasons:['Fixture approval'],evidence:[p.title]},stacks:{'stack-2':{decision:'eligible' as const,reasons:['Fixture backend'],evidence:[p.title]}}})
const collection=(p:any):any=>({version:1,runId:'geo-gate',sources:[source],positions:[p],scope,audit:[],createdAt:new Date().toISOString()})

test('missing geography passes by policy without inventing worldwide access',async()=>{
  const rules=await loadSelectionRules(),check=createAssessmentPrecheck(rules,scope)
  for(const [location,extra] of [['',''],['Remote',''],['Remote','\nWe are headquartered in Germany.'],['Remote','\nOverlap with European working hours.'],['Remote','\nOur customers are worldwide.']]){
    const p=position(location,body+extra),geo=createGeographyPrecheck(rules)!(p)
    assert.equal(check(p),undefined,location+extra);assert.equal(geo.status,'allowed');assert.match(geo.reason,/not verified worldwide/);assert.equal(p.location,location)
  }
})
test('missing listing location never overrides supplied description restrictions',async()=>{
  const check=createGeographyPrecheck(await loadSelectionRules())!
  for(const location of ['','Remote']){
    for(const line of ['You must be based in India.','Location: Singapore','This role is remote within the US.'])assert.equal(check(position(location,body+'\n'+line)).status,'excluded',line)
    for(const line of ['You must reside in EMEA.','You must not be based in India.','Location: EMEA','Applicants based in EMEA only.'])assert.equal(check(position(location,body+'\n'+line)).status,'unresolved',line)
    assert.equal(check(position(location,body+'\nLocation: Remote')).status,'allowed')
  }
})
test('affirmative country/worldwide options pass; outside-only and conflicting requirements do not',async()=>{
  const check=createGeographyPrecheck(await loadSelectionRules())!
  for(const location of ['Worldwide','Europe','London, GB','Yerevan, AM','Tbilisi, GE','Istanbul, TR','Almaty, KZ'])assert.equal(check(position(location)).status,'allowed',location)
  for(const location of ['US','India','Singapore'])assert.equal(check(position(location)).status,'excluded',location)
  assert.equal(check(position('Remote',body+'\nYou can work from anywhere in Europe.')).status,'allowed')
  assert.equal(check(position('Remote',body+'\nEmployees may work remotely from Germany.')).status,'allowed')
  assert.equal(check(position('US',body+'\nYou can work from anywhere in Germany.')).status,'unresolved')
  assert.equal(check(position('Remote - European Region | hybrid',body+'\nFully remote work from almost anywhere')).status,'allowed')
  assert.equal(check(position('Remote',body+'\nFully remote work from almost anywhere')).status,'unresolved')
})
test('optimistic approval for an unresolved supplied region cannot bypass cache or assessment gates',async()=>{
  const rules=await loadSelectionRules(),fixture=JSON.parse(await readFile(new URL('./fixtures/classification-six.json',import.meta.url),'utf8'))
  const p={...position('Remote'),...fixture.packets[0].vacancy,location:'EMEA',id:'p',source},value=approved(p)
  const cached:any={cacheVersion:'semantic-v1',key:decisionKey(p,scope.stacks,rules,'fixture'),policy:'fixture',semanticAssessment:value,origin:'assistant_session',observedRun:'old',reviewedAt:new Date().toISOString()}
  assert.equal(semanticCacheHit(p,scope.stacks,rules,'fixture',[cached]),undefined)
  assert.throws(()=>validateAssessment(value,p,scope.stacks,rules),/geography_evidence_required/)
  let calls=0
  const result=await classifyWithReuse({collection:collection(p),rules,cache:{p:cached},policy:'fixture'},{assess:async()=>{calls++;return value}})
  assert.equal(calls,1);assert.equal(result.classified.globalDecisions!.p.decision,'review');assert.deepEqual(result.classified.groups['stack-2'].matchedIds,[])
})
test('SQL save rejects a rehashed old acceptance when geography is unresolved before writing',async()=>{
  const rules=await loadSelectionRules(),p=position('Europe'),value=approved(p)
  const result=await classifyWithReuse({collection:collection(p),rules,cache:{},policy:'fixture'},{assess:async()=>value})
  const bad=structuredClone(result.classified);bad.collection.positions[0].location='EMEA'
  const {digest,...content}=bad;bad.digest=createHash('sha256').update(JSON.stringify(content)).digest('hex')
  let writes=0
  assert.throws(()=>assertClassificationIntegrity(bad),/geography_evidence_required/)
  await assert.rejects(saveClassification(bad,async fn=>fn({query:async()=>{writes++;throw Error('must not query')}} as any)),/classification_invalid/)
  assert.equal(writes,0)
})
test('unchanged allowed results reuse exact decisions with zero new assessor calls',async()=>{
  const rules=await loadSelectionRules(),p=position('Europe');let calls=0
  const first=await classifyWithReuse({collection:collection(p),rules,cache:{},policy:'fixture'},{assess:async()=>{calls++;return approved(p)}})
  const second=await classifyWithReuse({collection:collection(p),rules,cache:first.updates,policy:'fixture'},{assess:async()=>{throw Error('must reuse')}})
  assert.equal(calls,1);assert.equal(second.classified.evaluation!.hits,1);assert.equal(second.classified.evaluation!.calls,0)
})

test('complete unresolved geography reaches the assessor and requires source-bound geographic evidence',async()=>{
  const rules=await loadSelectionRules(),p=position('Berlin (Germany), remote-friendly')
  assert.equal(createGeographyPrecheck(rules)!(p).status,'unresolved')
  assert.equal(createAssessmentPrecheck(rules,scope)(p),undefined)
  let calls=0;const value=approved(p);value.global.evidence=[p.location]
  const first=await classifyWithReuse({collection:collection(p),rules,cache:{},policy:'fixture'},{assess:async()=>{calls++;return value}})
  assert.equal(calls,1);assert.deepEqual(first.classified.groups['stack-2'].matchedIds,['p']);assertClassificationIntegrity(first.classified)
  const again=await classifyWithReuse({collection:collection(p),rules,cache:first.updates,policy:'fixture'},{assess:async()=>{throw Error('must reuse')}})
  assert.equal(again.classified.evaluation!.hits,1)
  assert.throws(()=>validateAssessment({...value,global:{...value.global,evidence:['Paris, France']}},p,scope.stacks,rules),/geography_evidence_required/)
  let missingCalls=0
  const missing=await classifyWithReuse({collection:collection(position(p.location,'')),rules,cache:{},policy:'fixture'},{assess:async()=>{missingCalls++;return value}})
  assert.equal(missingCalls,0);assert.deepEqual(missing.classified.evaluation!.pendingIds,['p'])
})

test('generic authorization does not change supplied geography or hide a same-line restriction',async()=>{
  const check=createGeographyPrecheck(await loadSelectionRules())!
  const boilerplate='Applicants must be authorized to work in the country in which they apply and will be required to provide proof of employment eligibility as a condition of hire.'
  for(const location of ['Zurich, Switzerland','London, United Kingdom','Remote - Europe'])assert.equal(check(position(location,body+'\n'+boilerplate)).status,'allowed')
  assert.equal(check(position('Israel',body+'\n'+boilerplate)).status,'excluded')
  assert.equal(check(position('Remote',body+'\n'+boilerplate.replace('.','; you must be based in India.'))).status,'excluded')
})
test('old missing-geography policy keeps its behavior and cannot reuse decisions across the policy change',async()=>{
  const rules=await loadSelectionRules()
  const text=rules.text.replace(/```geography-precheck-json\s*\n([\s\S]*?)\n```/,(_,json)=>{const config=JSON.parse(json);delete config.missingGeography;delete config.unspecifiedLocationLabels;return '```geography-precheck-json\n'+JSON.stringify(config)+'\n```'})
  const old={...rules,text,sha256:createHash('sha256').update(text).digest('hex')}
  assert.equal(createGeographyPrecheck(old)!(position('')).status,'unresolved')
  assert.equal(createGeographyPrecheck(old)!(position('Remote')).status,'unresolved')
  assert.notEqual(decisionRulesHash(old),decisionRulesHash(rules))
  const p=position(''),value=approved(p)
  const cached:any={cacheVersion:'semantic-v1',key:decisionKey(p,scope.stacks,old,'fixture'),policy:'fixture',semanticAssessment:value,origin:'assistant_session',observedRun:'old',reviewedAt:new Date().toISOString()}
  assert.equal(semanticCacheHit(p,scope.stacks,rules,'fixture',[cached]),undefined)
  const result=await classifyWithReuse({collection:collection(p),rules,cache:{},policy:'fixture'},{assess:async()=>value})
  assertClassificationIntegrity(result.classified)
  assert.deepEqual(result.classified.groups['stack-2'].matchedIds,['p'])
})
