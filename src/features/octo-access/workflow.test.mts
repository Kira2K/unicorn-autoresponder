import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOctoService } from './service.mts';
import { provisionProfile, selectOctoProxy } from './provision.mts';
import { advanceGrant } from './grant-workflow.mts';
import { createMemoryStore, createMockCloud, mockClient, testConfig } from './testing.mts';
import { OctoError } from './contracts.mts';
async function fixture() {
  let time=1_800_000_000_000, draw=3741;
  const now=()=>time, store=createMemoryStore(), cloud=createMockCloud(store,now), config=structuredClone(testConfig);
  const deps={store,api:cloud.api,config,now,check:async()=>{}};
  const service=createOctoService({store,config,getClient:async id=>mockClient(id),now,password:()=>String(++draw).padStart(5,'0')});
  await Promise.all([service.ensure(901),service.ensure(902)]);
  for(const p of await store.list()) await provisionProfile(p,deps);
  const advance=async()=>{for(const p of await store.list()) await advanceGrant(p,deps);};
  return {store,cloud,service,config,deps,advance,now,tick:(ms:number)=>{time+=ms;}};
}
test('two concurrent grants expire independently; normal close clears, repeat keeps the five digits',async()=>{
  const f=await fixture(), [alex,bob]=await f.store.list();
  assert.equal(alex.password,'03742'); assert.notEqual(bob.password,alex.password);
  const a=await f.service.acquire(901,alex.id); await f.advance(); await f.cloud.start(alex.uuid!);
  const deadline=(await f.service.grant(901,a.id)).expiresAt;
  f.tick(15_000); const b=await f.service.acquire(902,bob.id); await f.advance(); await f.cloud.start(bob.uuid!);
  assert.equal((await f.service.acquire(901,alex.id)).id,a.id);
  assert.equal((await f.service.grant(901,a.id)).expiresAt,deadline);
  f.tick(30_000); await f.advance();
  assert.equal(f.cloud.profiles.get(alex.uuid!)!.folder,'home');
  assert.equal(f.cloud.profiles.get(alex.uuid!)!.has_user_password,true);
  assert.equal(f.cloud.profiles.get(alex.uuid!)!.status,1);
  assert.equal(f.cloud.profiles.get(bob.uuid!)!.folder,'guest');
  assert.equal('password' in await f.service.grant(901,a.id),false);
  await assert.rejects(f.service.acquire(901,alex.id),{code:'octo_cleanup_pending'});
  await f.cloud.stop(alex.uuid!); await f.advance();
  assert.equal((await f.store.get(alex.id))!.grant!.phase,'complete');
  assert.equal(f.cloud.profiles.get(alex.uuid!)!.has_user_password,false);
  f.tick(15_000); await f.advance(); await f.cloud.stop(bob.uuid!); await f.advance();
  assert.equal((await f.service.grant(902,b.id)).phase,'complete');
  const second=await f.service.acquire(901,alex.id); await f.advance();
  const next=await f.service.grant(901,second.id);
  assert.equal(next.password,'03742'); assert.notEqual(next.alias,(await f.store.get(bob.id))!.grant!.alias);
  assert.equal(f.cloud.calls.filter(c=>c==='create').length,2);
});
test('clients cannot enumerate or grant other profiles and secrets are absent from status',async()=>{
  const f=await fixture(), [alex,bob]=await f.store.list();
  await assert.rejects(f.service.status(903),{status:403});
  await assert.rejects(f.service.acquire(901,bob.id),{status:404});
  const g=await f.service.acquire(901,alex.id); await f.advance();
  await assert.rejects(f.service.grant(902,g.id),{status:404});
  assert.equal(JSON.stringify(await f.service.status(901)).includes(alex.password),false);
});
test('never-opened profile clears only after hide barrier; early close waits until deadline',async()=>{
  const f=await fixture(), [a,b]=await f.store.list();
  await f.service.acquire(901,a.id); await f.service.acquire(902,b.id); await f.advance();
  await f.cloud.start(b.uuid!); await f.cloud.stop(b.uuid!); await f.advance();
  assert.equal(f.cloud.profiles.get(b.uuid!)!.has_user_password,true);
  f.tick(45_000); await f.advance();
  assert.equal((await f.store.get(a.id))!.grant!.phase,'complete');
  assert.equal((await f.store.get(b.id))!.grant!.phase,'complete');
});
test('force-stop never clears protection but does not cancel timed hiding',async()=>{
  const f=await fixture(),[p]=await f.store.list();
  await f.service.acquire(901,p.id); await f.advance(); await f.cloud.start(p.uuid!); await f.cloud.force(p.uuid!);
  f.tick(45_000); await f.advance();
  assert.equal(f.cloud.profiles.get(p.uuid!)!.folder,'home');
  assert.equal(f.cloud.profiles.get(p.uuid!)!.has_user_password,true);
  assert.equal((await f.store.get(p.id))!.grant!.error,'octo_force_stop_observed');
});
test('expired event retention keeps the hidden profile protected',async()=>{
  const f=await fixture(),[p]=await f.store.list(); await f.service.acquire(901,p.id); await f.advance();
  await f.cloud.start(p.uuid!); f.tick(45_000); await f.cloud.stop(p.uuid!); await f.store.setCoverage(f.now()); await f.advance();
  assert.equal((await f.store.get(p.id))!.grant!.error,'octo_event_history_gap');
  assert.equal(f.cloud.profiles.get(p.uuid!)!.has_user_password,true);
});
test('lost create acknowledgement adopts exact operation marker without a duplicate',async()=>{
  const f=await fixture();
  const store=createMemoryStore(), cloud=createMockCloud(store,f.now);
  const service=createOctoService({store,config:f.config,getClient:async id=>mockClient(id)});
  await service.ensure(901); cloud.afterWrite(action=>{if(action==='create')throw new OctoError('octo_request_outcome_unknown');});
  const deps={...f.deps,store,api:cloud.api}; await provisionProfile((await store.list())[0],deps);
  assert.equal((await store.list())[0].pending,'create'); cloud.afterWrite();
  await provisionProfile((await store.list())[0],deps);
  assert.equal((await store.list())[0].phase,'ready'); assert.equal(cloud.calls.filter(c=>c==='create').length,1);
});
test('lost publish/clear acknowledgements recover by readback without changing the deadline/password',async()=>{
  const f=await fixture(),[p]=await f.store.list(); await f.service.acquire(901,p.id);
  f.cloud.afterWrite(action=>{if(action==='update')throw new OctoError('octo_request_outcome_unknown');});
  await f.advance(); const at=(await f.store.get(p.id))!.grant!.attemptedAt!;
  f.cloud.afterWrite(); f.tick(1000); await f.advance();
  assert.equal((await f.store.get(p.id))!.grant!.expiresAt,at+45_000);
  await f.cloud.start(p.uuid!); f.tick(45_000); await f.advance(); await f.cloud.stop(p.uuid!);
  f.cloud.afterWrite(action=>{if(action==='clear')throw new OctoError('octo_request_outcome_unknown');});
  await f.advance(); f.cloud.afterWrite(); await f.advance();
  assert.equal((await f.store.get(p.id))!.grant!.phase,'complete');
  assert.equal((await f.store.get(p.id))!.password,p.password);
  assert.equal(f.cloud.calls.filter(c=>c.startsWith('clear')).length,1);
});
test('store revision prevents duplicate grants from concurrent API callers',async()=>{
  const f=await fixture(),[p]=await f.store.list();
  const grants=await Promise.all([f.service.acquire(901,p.id),f.service.acquire(901,p.id)]);
  assert.equal(grants[0].id,grants[1].id);
});

test('failed hide retries only after readback confirms this protected grant remains shared',async()=>{
  const f=await fixture(),[p]=await f.store.list(); await f.service.acquire(901,p.id); await f.advance();
  await f.cloud.start(p.uuid!); f.tick(45_000);
  const update=f.cloud.api.updateProfile;
  f.cloud.api.updateProfile=async()=>{throw new OctoError('octo_request_outcome_unknown');};
  await f.advance(); assert.equal((await f.store.get(p.id))!.grant!.pending,'hide');
  f.cloud.api.updateProfile=update; await f.advance();
  assert.equal((await f.store.get(p.id))!.grant!.phase,'awaiting_close');
  assert.equal(f.cloud.profiles.get(p.uuid!)!.folder,'home');
  assert.equal(f.cloud.profiles.get(p.uuid!)!.has_user_password,true);
});

test('temporary cloud read failure does not cancel expiry or freeze close cleanup',async()=>{
  const f=await fixture(),[p]=await f.store.list(); await f.service.acquire(901,p.id); await f.advance();
  await f.cloud.start(p.uuid!);f.tick(45_000);
  const read=f.cloud.api.getProfile; f.cloud.api.getProfile=async()=>{throw new OctoError('octo_request_outcome_unknown');};
  await f.advance(); assert.equal((await f.store.get(p.id))!.grant!.phase,'granted');
  f.cloud.api.getProfile=read;await f.advance();assert.equal((await f.store.get(p.id))!.grant!.phase,'awaiting_close');
  await f.cloud.stop(p.uuid!);f.cloud.api.getProfile=async()=>{throw new OctoError('invalid_octo_response');};
  await f.advance();assert.equal((await f.store.get(p.id))!.grant!.phase,'awaiting_close');
  f.cloud.api.getProfile=read;await f.advance();assert.equal((await f.store.get(p.id))!.grant!.phase,'complete');
});

test('old ordinary closure cannot clear before complete history reaches the hide barrier',async()=>{
  const f=await fixture(),[p]=await f.store.list();await f.service.acquire(901,p.id);await f.advance();
  await f.cloud.start(p.uuid!);await f.cloud.stop(p.uuid!);f.tick(45_000);
  const events=f.store.events.bind(f.store);
  f.store.events=async(...args)=>(await events(...args)).filter(e=>e.action!=='profiles.updated');
  await f.advance();assert.equal((await f.store.get(p.id))!.grant!.phase,'awaiting_close');
  assert.equal(f.cloud.profiles.get(p.uuid!)!.has_user_password,true);
  f.store.events=events;await f.advance();assert.equal((await f.store.get(p.id))!.grant!.phase,'complete');
});

test('new event during clear journal save invalidates closure proof without sending clear',async()=>{
  const f=await fixture(),[p]=await f.store.list();await f.service.acquire(901,p.id);await f.advance();
  await f.cloud.start(p.uuid!);f.tick(45_000);await f.advance();await f.cloud.stop(p.uuid!);
  let checkpoint=1;const save=f.store.save.bind(f.store);
  f.store.save=async value=>{const result=await save(value);if(value.grant?.pending==='clear')checkpoint++;return result;};
  await advanceGrant((await f.store.get(p.id))!,{...f.deps,historyCheckpoint:()=>checkpoint});
  const g=(await f.store.get(p.id))!.grant!;
  assert.equal(g.phase,'awaiting_close');assert.equal(g.pending,undefined);
  assert.equal(f.cloud.calls.some(c=>c.startsWith('clear:')),false);
  f.store.save=save;await advanceGrant((await f.store.get(p.id))!,{...f.deps,historyCheckpoint:()=>checkpoint});
  assert.equal((await f.store.get(p.id))!.grant!.phase,'complete');
});
test('proxy selection prefers unused named, then Ready order, excludes reserved/used',async()=>{
  const f=await fixture(),[p]=await f.store.list();
  const proxies=[{uuid:'a',title:'Ready 10',profiles_count:0},{uuid:'b',title:'Ready 2',profiles_count:0},
    {uuid:'c',title:'Alex OctoTest',profiles_count:0},{uuid:'d',title:'Ready 1',profiles_count:1}];
  assert.equal(selectOctoProxy(proxies,p,new Set())?.uuid,'c');
  assert.equal(selectOctoProxy(proxies,p,new Set(['c']))?.uuid,'b');
});

test('legacy En/Both pool reservations remain independent and restore only after normal close',async()=>{
  let time=1_800_000_000_000;const now=()=>time,store=createMemoryStore(),cloud=createMockCloud(store,now);
  const proxies=[{uuid:'proxy1',title:'Ready 1',profiles_count:0},{uuid:'proxy2',title:'Ready 2',profiles_count:0}];
  cloud.api.listProxies=async()=>structuredClone(proxies);
  cloud.api.updateProxy=async(uuid,title)=>{proxies.find(p=>p.uuid===uuid)!.title=title;};
  const create=cloud.api.createProfile;
  cloud.api.createProfile=async input=>{const id=await create(input);if(input.proxy)proxies.find(p=>p.uuid===input.proxy)!.profiles_count++;return id;};
  const service=createOctoService({store,config:testConfig,now,getClient:async id=>({...mockClient(id),market:id===901?'Both':'En'})});
  const { reserveClientProfiles } = await import('./profile-reservation.mts');
  for (const id of [901,902]) await reserveClientProfiles(store,{...mockClient(id),market:id===901?'Both':'En'},false,now);
  const deps={store,api:cloud.api,config:testConfig,check:async()=>{},now};
  for(const p of await store.list())await provisionProfile(p,deps);
  const all=await store.list();assert.equal(all.length,4);assert.ok(all.every(p=>p.phase==='ready'));
  const en=all.filter(p=>p.locale==='en');assert.equal(new Set(en.map(p=>p.proxy!.uuid)).size,2);
  assert.ok(all.filter(p=>p.locale==='ru').every(p=>!p.proxy));
  const p=en.find(p=>p.clientId===901)!,title=p.proxy!.title;
  await service.acquire(901,p.id);await advanceGrant((await store.get(p.id))!,deps);
  assert.notEqual(proxies.find(q=>q.uuid===p.proxy!.uuid)!.title,title);
  await cloud.start(p.uuid!);time+=45_000;await advanceGrant((await store.get(p.id))!,deps);
  assert.notEqual(proxies.find(q=>q.uuid===p.proxy!.uuid)!.title,title);
  await cloud.stop(p.uuid!);await advanceGrant((await store.get(p.id))!,deps);
  assert.equal(proxies.find(q=>q.uuid===p.proxy!.uuid)!.title,title);
  assert.equal((await store.get(p.id))!.grant!.phase,'complete');
});
