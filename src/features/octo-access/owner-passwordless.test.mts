import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOctoService} from './service.mts';
import {provisionProfile} from './provision.mts';
import {advanceGrant} from './grant-workflow.mts';
import {createMemoryStore,createMockCloud,mockClient,testConfig} from './testing.mts';

async function setup(){
 let time=1_800_000_000_000;const now=()=>time,store=createMemoryStore(),cloud=createMockCloud(store,now),config={...testConfig,leaseMs:120_000};
 const service=createOctoService({store,config,getClient:async id=>mockClient(id),now,password:()=> '03742'});
 await service.ensure(901);const profile=(await store.list())[0],created:unknown[]=[];
 const api={...cloud.api,async createProfile(input:Parameters<typeof cloud.api.createProfile>[0]){created.push(structuredClone(input));return cloud.api.createProfile(input);}};
 const deps={store,api,config,check:async()=>{},now};
 return{store,cloud,service,profile,created,deps,tick(ms:number){time+=ms;}};
}

test('new private owner profiles are created without a password; stored transfer key is retained',async()=>{
 const f=await setup();await provisionProfile(f.profile,f.deps);const p=(await f.store.list())[0];
 assert.equal(p.phase,'ready');assert.equal(f.created.length,1);assert.equal(Object.hasOwn(f.created[0] as object,'password'),false);
 assert.equal((await f.cloud.api.getProfile(p.uuid!)).has_user_password,false);assert.equal(p.password,'03742');
 assert.ok(!f.cloud.calls.some(call=>call.startsWith('protect:')||call.startsWith('clear:')));
});

test('password is applied before guest publication and removed only after expiry and ordinary closure',async()=>{
 const f=await setup();await provisionProfile(f.profile,f.deps);let p=(await f.store.list())[0];
 const grant=await f.service.acquire(901,p.id);await advanceGrant((await f.store.get(p.id))!,f.deps);p=(await f.store.get(p.id))!;
 const live=()=>f.cloud.api.getProfile(p.uuid!);assert.equal((await live()).folder,'guest');assert.equal((await live()).has_user_password,true);
 assert.ok(f.cloud.calls.indexOf('protect:'+p.uuid)<f.cloud.calls.indexOf('update:'+p.uuid));assert.equal((await f.service.grant(901,grant.id)).password,'03742');
 await f.cloud.start(p.uuid!);f.tick(120_000);await advanceGrant((await f.store.get(p.id))!,f.deps);
 assert.equal((await live()).folder,'home');assert.equal((await live()).has_user_password,true);assert.equal('password' in await f.service.grant(901,grant.id),false);
 await f.cloud.stop(p.uuid!);await advanceGrant((await f.store.get(p.id))!,f.deps);p=(await f.store.get(p.id))!;
 assert.equal(p.grant!.phase,'complete');assert.equal((await live()).has_user_password,false);assert.equal(p.password,'03742');
});

test('lost create acknowledgement adopts the same password-free profile without another creation',async()=>{
 const f=await setup();f.cloud.afterWrite(action=>{if(action==='create')throw Object.assign(Error('unknown'),{code:'octo_request_outcome_unknown'});});
 await provisionProfile(f.profile,f.deps);assert.equal((await f.store.list())[0].pending,'create');f.cloud.afterWrite();
 await provisionProfile((await f.store.list())[0],f.deps);const p=(await f.store.list())[0];assert.equal(p.phase,'ready');assert.equal(f.created.length,1);assert.equal((await f.cloud.api.getProfile(p.uuid!)).has_user_password,false);
});

test('a legacy protected create is adopted without rewriting its password or recreating its data',async()=>{
 const f=await setup();const uuid=await f.cloud.api.createProfile({...f.profile.original,folder:'home',password:f.profile.password});
 await f.store.save({...f.profile,phase:'creating',pending:'create'});await provisionProfile((await f.store.list())[0],f.deps);
 const p=(await f.store.list())[0];assert.equal(p.uuid,uuid);assert.equal(p.phase,'ready');assert.equal(f.created.length,0);assert.equal((await f.cloud.api.getProfile(uuid)).has_user_password,true);
 assert.ok(!f.cloud.calls.some(call=>call.startsWith('protect:')||call.startsWith('clear:')));
});
