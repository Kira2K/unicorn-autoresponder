import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSelectionRules } from '../stack_classification/rules.ts'
import { createGeographyPrecheck } from '../stack_classification/geography-precheck.ts'
import { classifyWithReuse } from '../stack_classification/reuse.ts'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'

const body='Responsibilities: develop production Java backend services with Spring Boot, APIs and databases. Requirements: experience operating distributed systems and collaborating with a software engineering team.'
test('country-first ATS locations retain policy checks and ambiguous alternatives',async()=>{
  const check=createGeographyPrecheck(await loadSelectionRules())!
  for(const location of ['Cyprus','Cyprus, Ypsonas','Germany, Berlin','Ypsonas, Cyprus'])assert.equal(check({location,description:body}).status,'allowed',location)
  for(const location of ['India, Bengaluru','United States, Austin'])assert.equal(check({location,description:body}).status,'excluded',location)
  for(const location of ['Georgia, Atlanta','Cyprus, unknown location','Cyprus, Ypsonas / undisclosed location'])assert.equal(check({location,description:body}).status,'unresolved',location)
  assert.equal(check({location:'Cyprus, Ypsonas',description:body+'\nYou must reside in India.'}).status,'unresolved')
})
test('country aliases cannot overwrite canonical allowed ISO geography',async()=>{
  const check=createGeographyPrecheck(await loadSelectionRules())!
  for(const location of ['Remote, United Kingdom','UK','GB','United Kingdom','Russia','RU','Russian Federation'])assert.equal(check({location,description:body}).status,'allowed',location)
  for(const location of ['Myanmar (Burma)','Myanmar','MM'])assert.notEqual(check({location,description:body}).status,'allowed',location)
})
test('allowed countries, worldwide and unspecified remote pass; unknown supplied geography stays unresolved',async()=>{
  const check=createGeographyPrecheck(await loadSelectionRules())!
  for(const location of ['London, GB','Yerevan, AM','Tbilisi, GE','Istanbul, TR','Almaty, KZ','Tajikistan','Turkmenistan','Uzbekistan','Azerbaijan','Kyrgyzstan','Sweden','Remote - European Region | hybrid','Remote - Worldwide | hybrid','US or Germany'])assert.equal(check({location,description:body}).status,'allowed',location)
  for(const location of ['','Remote','Fully remote','Remote only','100% remote'])assert.equal(check({location,description:body}).status,'allowed',location)
  for(const location of ['EMEA','Georgia / unknown location','US / undisclosed location'])assert.equal(check({location,description:body}).status,'unresolved',location)
})
test('exact disallowed listing geographies are exclusions, not AI requests',async()=>{
  const check=createGeographyPrecheck(await loadSelectionRules())!
  for(const location of ['Remote from US','India only','Singapore','New York, NY, US','Georgia, US','US / Canada','Australia (hybrid)','Latin America'])assert.equal(check({location,description:body}).status,'excluded',location)
})
test('headquarters, travel and time zones cannot create or reverse employee location rules',async()=>{
  const check=createGeographyPrecheck(await loadSelectionRules())!
  for(const extra of ['We are headquartered in the US.','Travel to Singapore twice yearly.','Work with our India team.','Overlap with US working hours.']) {
    assert.equal(check({location:'Worldwide',description:body+' '+extra}).status,'allowed')
    assert.equal(check({location:'Remote',description:body+' '+extra}).status,'allowed')
  }
  assert.equal(check({location:'New York, US',description:body+'\nFully remote worldwide.'}).status,'allowed')
  assert.equal(check({location:'Remote',description:body+'\nYou must be based in India.'}).status,'excluded')
  assert.equal(check({location:'London, GB',description:body+'\nYou must be based in India.'}).status,'unresolved')
  assert.equal(check({location:'Remote',description:body+'\nYou must not be based in India.'}).status,'unresolved')
  assert.equal(check({location:'US',description:body+'\nYou can work from anywhere in Germany.'}).status,'unresolved')
})
test('worldwide and mandatory-location contradictions remain semantic work; multiple countries cannot silently disappear',async()=>{
  const check=createGeographyPrecheck(await loadSelectionRules())!
  assert.equal(check({location:'Worldwide',description:body+'\nCandidates must reside in the United States.'}).status,'unresolved')
  assert.equal(check({location:'US; Remote worldwide',description:body}).status,'allowed')
  assert.equal(check({location:'Paris, FR / Austin, US',description:body}).status,'allowed')
  assert.equal(check({location:'Remote',description:body+'\nYou must be located in the United States or Germany.'}).status,'allowed')
  assert.equal(check({location:'US (excluding California)',description:body}).status,'unresolved')
})
test('geography configuration is optional for old contracts, malformed present rules fail explicitly',async()=>{
  const rules=await loadSelectionRules(),none={...rules,text:rules.text.replace(/```geography-precheck-json[\s\S]*?```/,'')}
  assert.equal(createGeographyPrecheck(none),undefined)
  assert.throws(()=>createGeographyPrecheck({...none,text:none.text+'\n```geography-precheck-json\n{"version":1,"allowedCountryCodes":"AM"}\n```'}),/geography_precheck_configuration_invalid/)
})
test('allowed or missing geography reaches assessment; unknown supplied geography stays review',async()=>{
  const rules=await loadSelectionRules(),source={name:'Fixture',url:'https://fixture.test/jobs'},scope=buildCampaignScope({database:'fixture',stacks:[{id:'5',name:'Java',description:'Middle/senior Java Spring backend'}],students:[{studentId:'1',stackId:'5'}]})
  const positions=['Singapore','Yerevan, AM','Remote','EMEA'].map((location,i)=>({id:String(i),company:'Fixture',title:'Senior Java Developer',location,description:body,url:source.url+'/'+i,applyUrl:source.url+'/'+i,source,retrievedAt:new Date().toISOString()}))
  const collection:any={version:1,runId:'geo',sources:[source],positions,scope,audit:[],createdAt:new Date().toISOString()},calls:string[]=[]
  const result=await classifyWithReuse({collection,rules,cache:{},policy:'fixture'},{assess:async(p,stacks)=>{calls.push(p.id);const d={decision:'eligible' as const,reasons:['Fixture full description reviewed'],evidence:[p.title]};return {global:d,stacks:Object.fromEntries(stacks.map(s=>[s.id,d]))}}})
  assert.deepEqual(calls,['1','2','3']);assert.equal(result.classified.globalDecisions?.['0'].decision,'excluded');assert.equal(result.classified.evaluation?.records['0'].origin,'deterministic_precheck');assert.equal(result.updates['0'],undefined)
  assert.deepEqual(result.classified.groups['stack-5'].matchedIds,['1','2']);assert.equal(result.classified.globalDecisions?.['3'].decision,'review');assert.equal(result.updates['3'],undefined)
})
