import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {loadOctoHhTarget} from './target.mts';
import type {OctoHhTargetDependencies} from './target.mts';
import type {AppDbRow} from '../../../platform/db/postgres/record-source.mts';
const {TABLES}=createRequire(import.meta.url)('../../../integrations/noco/core/schema.ts') as {TABLES:Record<string,{id:string}>};
function fixture(enabled=true){
  const clients:AppDbRow[]=[{Id:1,client_name:'Kira fixture',rel_clients_primary_stack:{Id:4,name:'Go'},stop_list_company:'Blocked One'}];
  const rows:AppDbRow[]=[{Id:8,clients_id:1,'Делаем_отклики_Ru':false,'Делаем_отклики_En':enabled,
    'Сопровод_Ru':'Russian cover','Сопровод_En':'English cover'}];
  const stacks:AppDbRow[]=[{Id:4,name:'Go',hh_scenario_url_ru:'https://hh.ru/search/vacancy?text=go-ru',
    hh_scenario_url_en:'https://hh.ru/search/vacancy?text=go-en'}];
  const restrictions:AppDbRow[]=[{Id:9,market:'en',rel_restrictions_client:{Id:1},
    rel_restrictions_blocked_companies:[{Id:100,company_name:'En restriction'}]},
    {Id:10,market:'ru',rel_restrictions_client:{Id:1},rel_restrictions_blocked_companies:[{Id:101,company_name:'Ru restriction'}]}];
  const tables=new Map([[TABLES.clients.id,clients],[TABLES.hhAutoresponses.id,rows],[TABLES.stacks.id,stacks],[TABLES.restrictions.id,restrictions]]);
  const reads:string[]=[],credentialCalls:Array<{name:string;market:string}>=[];
  const deps:OctoHhTargetDependencies={source:{async fetchRecords(id){reads.push(id);return structuredClone(tables.get(id)??[]);}},
    async credentials(name,market){credentialCalls.push({name,market});return {login:'login-fixture',password:'private-fixture',market};}};
  return {clients,rows,stacks,restrictions,tables,reads,credentialCalls,deps};
}
test('read-only target uses explicit HH market and existing stack/restriction rules without any Dolphin binding',async()=>{
  const f=fixture(),result=await loadOctoHhTarget({clientId:1,market:'En'},f.deps);
  assert.equal(result.readiness.ready,true);assert.equal(result.target?.market,'En');
  assert.equal(result.target?.coverText,'English cover');assert.match(result.target!.stackScenario,/go-en/);
  assert.deepEqual(result.target?.blockedCompanies.map(c=>c.name),['Comtek','Blocked One','En restriction']);
  assert.deepEqual(f.credentialCalls,[{name:'Kira fixture',market:'En'}]);
  assert.equal(f.reads.includes(TABLES.dolphinProfiles.id),false);
  assert.equal(Object.hasOwn(result.target!,'dolphinProfileId'),false);
  assert.equal(JSON.stringify(result.readiness).includes('private-fixture'),false);
  assert.equal(JSON.stringify(result.readiness).includes('login-fixture'),false);
  assert.equal(JSON.stringify(result.readiness).includes('https://'),false);
});
test('disabled HH flag requires explicit manual opt-in and is never changed',async()=>{
  const f=fixture(false),before=structuredClone(f.rows);
  const disabled=await loadOctoHhTarget({clientId:1,market:'En'},f.deps);
  assert.equal(disabled.readiness.reason,'autoresponse_disabled');assert.equal(disabled.target,undefined);assert.equal(f.credentialCalls.length,0);
  const approved=await loadOctoHhTarget({clientId:1,market:'En',allowDisabled:true},f.deps);
  assert.equal(approved.readiness.ready,true);assert.equal(approved.readiness.enabled,false);
  assert.equal(approved.readiness.manualOptIn,true);assert.equal(approved.readiness.reason,'ready_manual_opt_in');
  assert.deepEqual(f.rows,before);
});
test('ambiguous client, autoresponse, and stack inputs fail before credentials can be selected',async()=>{
  const cases:Array<{change:(f:ReturnType<typeof fixture>)=>void;reason:string}>=[
    {change:f=>f.clients.push({...f.clients[0]}),reason:'client_ambiguous'},
    {change:f=>f.clients.push({...f.clients[0],Id:2}),reason:'client_name_ambiguous'},
    {change:f=>f.rows.push({...f.rows[0],Id:9}),reason:'autoresponse_ambiguous'},
    {change:f=>f.stacks.push({...f.stacks[0]}),reason:'stack_ambiguous'},
    {change:f=>{f.rows[0]['Stack Override']=[{Id:4},{Id:5}];},reason:'stack_ambiguous'},
    {change:f=>{f.clients[0].rel_clients_primary_stack={name:'Go'};f.stacks.push({Id:5,name:'Other',hh_scenario_alias:'Go'});},reason:'stack_ambiguous'}
  ];
  for(const item of cases){const f=fixture();item.change(f);const result=await loadOctoHhTarget({clientId:1,market:'En'},f.deps);
    assert.equal(result.readiness.reason,item.reason);assert.equal(result.target,undefined);assert.equal(f.credentialCalls.length,0);}
});
test('missing scenario, cover, credentials and LinkedIn scenarios fail closed with safe readiness reasons',async()=>{
  const scenario=fixture();delete scenario.stacks[0].hh_scenario_url_en;
  assert.equal((await loadOctoHhTarget({clientId:1,market:'En'},scenario.deps)).readiness.reason,'scenario_missing');
  const cover=fixture();cover.rows[0]['Сопровод_En']='   ';
  assert.equal((await loadOctoHhTarget({clientId:1,market:'En'},cover.deps)).readiness.reason,'cover_missing');
  const unsafe=fixture();unsafe.stacks[0].hh_scenario_url_en='https://linkedin.com/jobs/';
  assert.equal((await loadOctoHhTarget({clientId:1,market:'En'},unsafe.deps)).readiness.reason,'scenario_invalid');
  const credential=fixture();credential.deps.credentials=async()=>({login:'',password:''});
  assert.equal((await loadOctoHhTarget({clientId:1,market:'En'},credential.deps)).readiness.reason,'credentials_missing');
  credential.deps.credentials=async()=>{throw new Error('password/provider secret');};
  const failure=await loadOctoHhTarget({clientId:1,market:'En'},credential.deps);
  assert.equal(failure.readiness.reason,'credentials_unavailable');assert.equal(JSON.stringify(failure).includes('secret'),false);
});
test('input validation performs no reads and supported existing response-page scenarios are retained',async()=>{
  const f=fixture();const bad=await loadOctoHhTarget({clientId:0,market:'En'},f.deps);
  assert.equal(bad.readiness.reason,'invalid_target_input');assert.deepEqual(f.reads,[]);
  f.stacks[0].hh_scenario_url_en='https://hh.ru/applicant/vacancy_response?fixture';
  const good=await loadOctoHhTarget({clientId:1,market:'En'},f.deps);assert.equal(good.readiness.ready,true);
});
test('explicit run-only cover override preserves exact supplied text and leaves empty database cover unchanged',async()=>{
  const f=fixture(false);f.rows[0]['Сопровод_En']='';const before=structuredClone(f.rows);
  const text='Здравствуйте! Буду рада обсудить вакансию!';
  const result=await loadOctoHhTarget({clientId:1,market:'En',allowDisabled:true,coverTextOverride:text},f.deps);
  assert.equal(result.readiness.ready,true);assert.equal(result.readiness.coverSource,'run_override');
  assert.equal(result.target?.coverText,text);assert.equal(JSON.stringify(result.readiness).includes(text),false);
  assert.deepEqual(f.rows,before);
  const empty=await loadOctoHhTarget({clientId:1,market:'En',allowDisabled:true,coverTextOverride:'  \n '},f.deps);
  assert.equal(empty.readiness.reason,'cover_missing');assert.equal(empty.target,undefined);
  const missing=await loadOctoHhTarget({clientId:1,market:'En',allowDisabled:true},f.deps);
  assert.equal(missing.readiness.reason,'cover_missing');assert.deepEqual(f.rows,before);
});
