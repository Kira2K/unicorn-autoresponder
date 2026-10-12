import test from 'node:test'
import assert from 'node:assert/strict'
import { checkSalary } from '../stack_classification/salary-precheck.ts'
import { classifyWithReuse, decisionKey } from '../stack_classification/reuse.ts'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'

const check = (description:string) => checkSalary({description},3000)
test('percentage-only incentive boilerplate is not a stated base salary',()=>{
  assert.equal(check('Sales roles are also eligible for incentive pay targeted at up to 100% of the offered base salary.').status,'not_stated')
  assert.equal(check('Salary: USD 24,000 per year plus a 10% incentive.').status,'excluded')
  assert.equal(check('Salary: 24000 per year.').status,'review')
})
test('salary upper bounds use deterministic monthly arithmetic, not the bottom of a range',()=>{
  assert.equal(check('Salary: USD 2,500–4,000 gross per month.').status,'pass')
  assert.equal(check('Salary: USD 24k–30k gross per year.').status,'excluded')
  assert.equal(check('Salary: 36,000 USD per year.').status,'pass')
  assert.equal(check('Salary: from USD 2,000 per month.').status,'pass')
  assert.equal(check('Salary: up to USD 2,900 per month.').status,'excluded')
  assert.equal(check('Salary: USD 2,000+ per month.').status,'pass')
})
test('missing basis, ambiguous dollars, net pay and FX are data issues, never invented conversions',()=>{
  for(const body of ['Salary: USD 25 per hour.','Salary: EUR 2,000 per month.','Salary: USD 2,000 net per month.','Salary: $2,000 per month.','Salary: USD 2500.']) assert.equal(check(body).status,'review',body)
  const rates={asOf:'2026-09-30',source:'fixture:fx',usdPerUnit:{EUR:1.2}}
  assert.equal(checkSalary({description:'Salary: EUR 2,000 per month.'},3000,rates).status,'excluded')
  assert.equal(checkSalary({description:'Salary: €3.000,50 per month.'},3000,rates).status,'pass')
  assert.equal(checkSalary({description:'Salary: EUR 2,000 per month.'},3000,{...rates,asOf:'invalid'}).status,'review')
})
test('working time must be explicit, and minimum-only structured compensation is not an upper bound',()=>{
  assert.equal(check('Salary: USD 10 per hour; 40 hours per week.').status,'excluded')
  assert.equal(checkSalary({description:'',compensation:{min:2000,currency:'USD',period:'month'}},3000).status,'pass')
  assert.equal(checkSalary({description:'',compensation:{min:2000,max:2000,currency:'USD',period:'month'}},3000).status,'excluded')
  assert.equal(checkSalary({description:'',compensation:{min:100,max:120,currency:'USD',period:'day',daysPerWeek:5}},3000).status,'excluded')
})
test('funding, benefits and employee referrals are not salary; ambiguous salary alternatives are retained for data review',()=>{
  for(const body of ['We raised USD 25m this year.','USD 2,000 learning budget per year.','Referral bonus: USD 100 per hire.','Competitive salary and great benefits.']) assert.equal(check(body).status,'not_stated',body)
  assert.equal(check('Salary: USD 2000 per month or EUR 3000 per month.').status,'review')
  assert.equal(check('Salary: USD 4,000-2,000 per month.').status,'review')
})

test('shared prechecks run before cached or new AI assessment, and FX is bound to cache identity',async()=>{
  const rules=await loadSelectionRules(),source={name:'Fixture',url:'https://fixture.test/jobs'}
  const scope=buildCampaignScope({database:'fixture',stacks:[{id:'5',name:'Java',description:'Middle/senior Java backend.'}],students:[{studentId:'1',stackId:'5'}]})
  const body='Responsibilities include implementing Java backend services and APIs, operating production databases and collaborating with the product engineering team.'
  const positions=['Support Engineer','Middle Java Developer','Senior Java Developer'].map((title,i)=>({id:String(i),title,company:'Fixture',description:body+(i===1?' Salary: USD 24k per year.':''),location:'Worldwide',url:source.url+'/'+i,applyUrl:source.url+'/'+i,source,retrievedAt:new Date().toISOString()}))
  const collection:any={version:1,runId:'salary-gate',scope,sources:[source],positions,audit:[],createdAt:new Date().toISOString()}
  const calls:string[]=[]
  const result=await classifyWithReuse({collection,rules,cache:{},policy:'fixture'}, {assess:async p=>{calls.push(p.id);return {global:{decision:'excluded',reasons:['Fixture'],evidence:[p.title]},stacks:{}}}})
  assert.deepEqual(calls,['2']);assert.equal(result.classified.evaluation?.calls,1)
  assert.equal(result.classified.evaluation?.records['0'].origin,'deterministic_precheck')
  assert.equal(result.classified.globalDecisions?.['1'].decision,'excluded')
  assert.equal(result.updates['0'],undefined);assert.equal(result.updates['1'],undefined)
  const rates={asOf:'2026-09-30',source:'fixture',usdPerUnit:{EUR:1.2}}
  assert.equal(decisionKey(positions[2],scope.stacks,rules,'fixture'),decisionKey(positions[2],scope.stacks,rules,'fixture',new Date(),rates))
  assert.equal(decisionKey(positions[1],scope.stacks,rules,'fixture'),decisionKey(positions[1],scope.stacks,rules,'fixture',new Date(),rates))
  const euro={...positions[2],description:body+' Salary: EUR 6600 gross per month.'}
  assert.notEqual(decisionKey(euro,scope.stacks,rules,'fixture'),decisionKey(euro,scope.stacks,rules,'fixture',new Date(),rates))
  assert.notEqual(decisionKey(euro,scope.stacks,rules,'fixture',new Date(),rates),decisionKey(euro,scope.stacks,rules,'fixture',new Date(),{...rates,asOf:'2026-10-01'}))
  assert.equal(decisionKey(euro,scope.stacks,rules,'fixture',new Date(),rates),decisionKey(euro,scope.stacks,rules,'fixture',new Date(),{...rates,usdPerUnit:{...rates.usdPerUnit,GBP:1.3}}))
})
