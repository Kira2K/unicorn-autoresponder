import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCreationTaskService } from './service.mts';
import type { CreationTaskStore } from './postgres-store.mts';
import { createMemoryStore, createMockCloud, mockClient, testConfig } from '../../octo-access/testing.mts';
import { createOctoService } from '../../octo-access/service.mts';
import { createTaskProxyCapture } from './proxy-capture.mts';
import { providerStatus, studentLocked } from './contracts.mts';
import { guardAccount } from './account-guard.mts';
import type { SqlSession } from '../../../integrations/postgres/contracts.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
async function fixture() {
  const profiles=createMemoryStore(),cloud=createMockCloud(profiles);
  const config={...testConfig,allowAll:true};
  const octo=createOctoService({store:profiles,config,getClient:async (id:number)=>({...mockClient(id),market:'Both'})});
  await profiles.reserve(['ru','en'].map(locale=>({clientId:901,locale:locale as 'ru'|'en',password:'12345',operationId:'test',
    phase:'ready',ownProxy:true,createdAt:Date.now(),original:{title:locale,description:locale,tags:[],start_pages:[]}})));
  for(const p of await profiles.list()) { const uuid=await cloud.api.createProfile({...p.original,folder:'home',password:p.password}); await profiles.save({...p,uuid}); }
  cloud.api.readProfileProxy=async()=>({saved:{uuid:'proxy',title:'saved',profiles_count:1,type:'socks5',host:'example.org',port:1080,login:'login',password:'secret'}});
  for(const p of await profiles.list()) cloud.profiles.get(p.uuid!)!.proxy={uuid:'proxy'};
  const task={id:1,clientId:901,linkedinAccountId:11,outlookAccountId:12,status:'не начата' as const,version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  let received:unknown;
  const store={async list(){return[task];},async detail(id:number){if(id!==1)throw Object.assign(Error(),{code:'linkedin_task_not_found'});return {task,intake:{url:'',login:'',hasPassword:false,outlookLogin:'outlook@outlook.com',hasOutlookPassword:true,firstName:'A',lastName:'B',realLocation:'C',blockedAccounts:[]}};},
    async receipt(...args:unknown[]){received=args;return task;},async status(){return task;}} as unknown as CreationTaskStore;
  const capture=createTaskProxyCapture({store:profiles,api:cloud.api,config,octo});
  const secrets:unknown[]=[];
  const service=createCreationTaskService({store,profiles,octo,client:async id=>mockClient(id),capture,
    secrets:async(...args)=>{secrets.push(args);return{password:'secret'};},nodeMavenKey:()=> 'key-secret'});
  return {service,profiles,cloud,task,capture,received:()=>received,secrets};
}
test('statuses use expert wording; contractor cannot choose confirmation',()=>{
  assert.equal(providerStatus('сделана экспертом'),'сделана экспертом');
  assert.throws(()=>providerStatus('выполнение подтверждено'));
  assert.throws(()=>providerStatus('сделана исполнителем'));
  assert.equal(studentLocked('сделана экспертом'),true);assert.equal(studentLocked('блок'),false);
});
test('task scopes EN profile, grants and account secrets; no arbitrary client/profile access',async()=>{
  const f=await fixture(),status=await f.service.profileStatus(1);
  assert.deepEqual(status.profiles.map(p=>p.locale),['en']);
  await assert.rejects(f.service.acquire(1,1),{code:'forbidden'});
  await assert.rejects(f.service.grant(1,'other-grant'),{code:'forbidden'});
  await assert.rejects(f.service.detail(2),{code:'linkedin_task_not_found'});
  await f.service.secrets(1,'outlook');assert.deepEqual(f.secrets,[[901,12]]);
  await assert.rejects(f.service.secrets(1,'13'));
});

test('expert proxy form reuses student saving, scopes the selected EN profile and hides other profiles',async()=>{
  const f=await fixture();
  const input={type:'socks5',host:'demo-proxy.example.test',port:1080,login:'fixture',password:'fixture-secret'};
  await assert.rejects(f.service.saveProxy(1,1,input),{code:'forbidden'});
  await assert.rejects(f.service.saveProxy(1,2,{...input,port:0}),{code:'octo_proxy_input_invalid'});
  assert.deepEqual(await f.service.saveProxy(1,2,input),{queued:true});
  const p=(await f.profiles.get(2))!;
  assert.equal(p.proxyChange?.phase,'queued');assert.deepEqual(p.proxyChange?.input,input);
  assert.equal((await f.profiles.get(1))!.proxyChange,undefined);
  assert.deepEqual((await f.service.profileStatus(1)).profiles.map(p=>p.locale),['en']);
  await assert.rejects(f.service.capture(1,{version:1}),{code:'linkedin_task_close_profile_first'});
});
test('capture stores reference receipt only after closed, private EN profile proxy is persisted',async()=>{
  const f=await fixture();await f.service.capture(1,{version:1});
  const p=(await f.profiles.list()).find(p=>p.locale==='en')!;
  assert.equal(p.proxy?.uuid,'proxy');assert.ok(!JSON.stringify(p.proxy).includes('secret'));
  assert.deepEqual(f.received(),[1,1,p.id,'proxy',p.revision]);
  await assert.rejects(f.service.capture(1,{version:2}),{code:'linkedin_task_stale_version'});
});
test('active, still closing, running, public and shared profiles cannot produce receipt',async()=>{
  for(const state of ['active','closing','running','public','shared']) {
    const f=await fixture(),p=(await f.profiles.list()).find(p=>p.locale==='en')!;
    if(state==='active'||state==='closing') await f.profiles.save({...p,grant:{id:'g',phase:state==='active'?'granted':'awaiting_close',alias:'alias',createdAt:Date.now(),eventsAfter:0,original:p.original}});
    if(state==='running') f.cloud.profiles.get(p.uuid!)!.status=1;
    if(state==='public') f.cloud.profiles.get(p.uuid!)!.folder='guest';
    if(state==='shared') f.cloud.api.readProfileProxy=async()=>({saved:{uuid:'proxy',title:'p',profiles_count:2,type:'http',host:'x',port:80,login:'',password:''}});
    await assert.rejects(f.service.capture(1,{version:1}));assert.equal(f.received(),undefined);
  }
});
test('done cannot bypass proxy button, stale cloud proxy and confirmed task visibility',async()=>{
  const f=await fixture();await assert.rejects(f.service.status(1,{version:1,status:'сделана экспертом'}),{code:'linkedin_task_proxy_required'});
  Object.assign(f.task,{proxySavedAt:new Date().toISOString(),proxyUuid:'old',proxyProfileId:2});
  await assert.rejects(f.service.status(1,{version:1,status:'сделана экспертом'}),{code:'linkedin_task_proxy_required'});
});
test('inline connection queues existing durable workflow once and never returns a premature receipt',async()=>{
  const f=await fixture();f.cloud.api.readProfileProxy=async()=>({inline:{type:'socks5',host:'inline.example.org',port:1080,login:'l',password:'p'}});
  await assert.rejects(f.service.capture(1,{version:1}),{code:'linkedin_task_proxy_pending'});
  const pending=(await f.profiles.list()).find(p=>p.locale==='en')!.proxyChange;
  assert.equal(pending?.phase,'queued');assert.equal(f.received(),undefined);
  await assert.rejects(f.service.capture(1,{version:1}));
  assert.equal((await f.profiles.list()).find(p=>p.locale==='en')!.proxyChange?.id,pending?.id);
});
test('lost proxy-reference acknowledgement cannot produce a receipt; retry rereads without creating a proxy',async()=>{
  const f=await fixture(),save=f.profiles.save.bind(f.profiles);let lost=true;
  f.profiles.save=async p=>{const saved=await save(p);if(lost){lost=false;throw new PostgresReadError('commit_uncertain');}return saved;};
  await assert.rejects(f.service.capture(1,{version:1}),{code:'commit_uncertain'});assert.equal(f.received(),undefined);
  await f.service.capture(1,{version:1});assert.ok(f.received());
  assert.equal(f.cloud.calls.filter(c=>c==='create').length,2,'only the original two profiles exist');
});
test('generic platform account guard protects LinkedIn/Outlook terminal tasks only',async()=>{
  let platform='linkedin',status='сделана экспертом',locks=0;
  const session={query:async(sql:string)=>{
    if(sql.includes('FROM noco.platform_accounts'))return{rows:[{clients_id:901,platforms_id:16}]};
    if(sql.includes('FROM noco.platforms'))return{rows:[{name:platform}]};
    if(sql.includes('FROM noco.linkedin_creation_task'))return{rows:[{status}]};
    if(sql.includes('FOR UPDATE'))locks++;
    return{rows:[]};
  }} as unknown as SqlSession;
  await assert.rejects(guardAccount(session,['11']),{code:'linkedin_task_student_edit_locked'});
  platform='email_outlook';await assert.rejects(guardAccount(session,undefined,{clients_id:901,platforms_id:31}),{code:'linkedin_task_student_edit_locked'});
  status='блок';await guardAccount(session,['11']);
  platform='github';await guardAccount(session,['11']);assert.equal(locks,3);
});
