import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalStore} from './test-store.mts';
import {createMockCloud,mockClient,testConfig} from '../testing.mts';
import {createOctoService} from '../service.mts';
import {provisionProfile} from '../provision.mts';
import {advanceGrant} from '../grant-workflow.mts';
import {createBridgeBroker} from './broker.mts';
test('backend restart retains authorization and accepts a replayed success; disabling bridge cannot send a cloud retry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'octo-bridge-backend-'));
 let disk=await openLocalStore(join(root,'state.json'),'bridge-fixture'),time=Date.now();
 const now=()=>time,config={...testConfig,leaseMs:120000},bridge={id:'owner',ownerEmail:'owner@example.com'};
 const cloud=createMockCloud(disk.store,now),device='a'.repeat(64);
 try{
  const service=createOctoService({store:disk.store,config,now,getClient:async id=>mockClient(id)});
  await service.ensure(901);let [p]=await disk.store.list();
  const deps=()=>({store:disk.store,api:cloud.api,config,now,check:async()=>{},passwordBridge:bridge});
  await provisionProfile(p,deps());[p]=await disk.store.list();await service.acquire(901,p.id);
  await advanceGrant((await disk.store.get(p.id))!,deps());await cloud.start(p.uuid!);
  time+=120000;await advanceGrant((await disk.store.get(p.id))!,deps());await cloud.stop(p.uuid!);
  await advanceGrant((await disk.store.get(p.id))!,deps());
  let broker=createBridgeBroker({...deps(),bridge,checkpoint:async()=>0});const task=(await broker.poll(device))!;
  await broker.authorize(device,task.id);cloud.profiles.get(p.uuid!)!.has_user_password=false;
  await disk.close();disk=await openLocalStore(join(root,'state.json'),'bridge-fixture');
  // Same SQL-JSON contract, replayed here with a durable test adapter.
  await advanceGrant((await disk.store.get(p.id))!,{...deps(),passwordBridge:undefined});
  assert.equal((await disk.store.get(p.id))!.grant!.phase,'awaiting_close');
  broker=createBridgeBroker({...deps(),bridge,checkpoint:async()=>0});
  await assert.rejects(broker.authorize(device,task.id),{code:'octo_bridge_already_authorized'});
  await broker.result(device,task.id,{state:'succeeded'});await broker.result(device,task.id,{state:'succeeded'});
  await advanceGrant((await disk.store.get(p.id))!,deps());
  assert.equal((await disk.store.get(p.id))!.grant!.phase,'complete');
  assert.equal((await disk.store.get(p.id))!.password,p.password);
  assert.equal(cloud.calls.filter(c=>c.startsWith('clear:')).length,0);
 }finally{await disk.close();await rm(root,{recursive:true,force:true});}
});
