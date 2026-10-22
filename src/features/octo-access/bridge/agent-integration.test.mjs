import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createAgent} from '../../../../octo-bridge/agent.mjs';
import {openJournal} from '../../../../octo-bridge/journal.mjs';
import {createBridgeBroker} from './broker.mts';
import {bridgeRoutes,bridgePath} from './routes.mts';
import {advanceGrant} from '../grant-workflow.mts';
import {provisionProfile} from '../provision.mts';
import {createOctoService} from '../service.mts';
import {createMemoryStore,createMockCloud,mockClient,testConfig} from '../testing.mts';
const express=createRequire(import.meta.url)('express');
test('real HTTP bridge with durable PC state: two clients, three cycles, restart, independent deadlines and no cloud clear',async()=>{
 let time=Date.now();const now=()=>time,store=createMemoryStore(),cloud=createMockCloud(store,now);
 const config={...testConfig,leaseMs:120000},bridge={id:'test-pc',ownerEmail:'owner@example.com',secret:'a'.repeat(48)};
 const deps={store,api:cloud.api,config,now,check:async()=>{},passwordBridge:bridge};
 const service=createOctoService({store,config,now,getClient:async id=>mockClient(id)});
 await service.ensure(901);await service.ensure(902);for(const p of await store.list())await provisionProfile(p,deps);
 const profiles=await store.list(),advance=async()=>{for(const p of await store.list())await advanceGrant(p,deps);};
 const app=express();app.use(bridgePath,bridgeRoutes(createBridgeBroker({...deps,bridge,checkpoint:async()=>0}),bridge));
 const server=app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
 const backendUrl=`http://127.0.0.1:${server.address().port}`,root=await mkdtemp(join(tmpdir(),'octo-bridge-http-'));
 const agentConfig={backendUrl,bridgeId:bridge.id,ownerEmail:bridge.ownerEmail,secret:bridge.secret,allowedProfileUuids:profiles.map(p=>p.uuid)};
 let journal=await openJournal(join(root,'state.json'),agentConfig,'fixture-machine'),deletes=0,lostReceipt=false;
 const fetchImpl=async(input,init)=>{
  const u=new URL(String(input));
  if(u.origin===backendUrl){
   if(u.pathname.endsWith('/result')&&lostReceipt){lostReceipt=false;await fetch(input,init);throw Error('lost receipt ack');}
   return fetch(input,init);
  }
  assert.equal(u.origin,'http://127.0.0.1:58888');
  if(u.pathname.endsWith('/username'))return Response.json({username:bridge.ownerEmail});
  if(u.pathname.endsWith('/active'))return Response.json([...cloud.profiles.values()].filter(p=>p.status===1).map(p=>({uuid:p.uuid})));
  assert.equal(u.pathname,'/api/profiles/password');assert.equal(init.method,'DELETE');
  const body=JSON.parse(init.body),p=cloud.profiles.get(body.uuid);assert.ok(p);assert.equal(p.folder,'home');assert.equal(p.status,0);
  assert.equal(body.password,profiles.find(p=>p.uuid===body.uuid).password);deletes++;p.has_user_password=false;
  return Response.json({msg:'Profile password has been cleared'});
 };
 let agent=createAgent({config:agentConfig,journal,fetchImpl,now});
 try{
  assert.equal((await fetch(backendUrl+bridgePath+'/poll',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
  await agent.check();
  for(let cycle=0;cycle<3;cycle++){
   const activeConfig=cycle===2?{...agentConfig,allowedProfileUuids:[],allowAllManagedProfiles:true}:agentConfig;
   agent=createAgent({config:activeConfig,journal,fetchImpl,now});
   const[a,b]=profiles;await service.acquire(a.clientId,a.id);await advance();await cloud.start(a.uuid);
   time+=1000;await service.acquire(b.clientId,b.id);await advance();await cloud.start(b.uuid);
   time+=119000;await advance();assert.equal(cloud.profiles.get(a.uuid).status,1);assert.equal(cloud.profiles.get(b.uuid).folder,'guest');
   await agent.step();assert.equal(deletes,cycle*2);
   await cloud.stop(a.uuid);await advance();time+=1000;await advance();
   if(cycle===0)lostReceipt=true;
   await agent.step().catch(()=>{});
   await journal.close();journal=await openJournal(join(root,'state.json'),agentConfig,'fixture-machine');
   agent=createAgent({config:activeConfig,journal,fetchImpl,now});await agent.step();await advance();
   assert.equal(deletes,cycle*2+1);assert.equal((await store.get(a.id)).grant.phase,'complete');
   assert.equal(cloud.profiles.get(b.uuid).status,1);await cloud.stop(b.uuid);await advance();await agent.step();await advance();
   assert.equal(deletes,cycle*2+2);assert.equal((await store.get(b.id)).grant.phase,'complete');
   for(const p of profiles)assert.equal((await store.get(p.id)).password,p.password);
  }
  assert.equal(cloud.calls.filter(c=>c.startsWith('clear:')).length,0);
 }finally{await journal.close();await new Promise(done=>server.close(done));await rm(root,{recursive:true,force:true});}
});
