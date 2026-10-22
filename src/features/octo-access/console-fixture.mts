import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createMemoryStore, createMockCloud, testConfig } from './testing.mts';
import { createOctoRuntime } from './runtime.mts';
import { createBridgeBroker } from './bridge/broker.mts';
import { bridgeRoutes } from './bridge/routes.mts';
import { withBridgeRoutes } from './bridge/app.mts';
import type { BridgeConfig } from './bridge/config.mts';
import type { ActionLogOptions } from '../octo-access-test/action-log.mts';
const require=createRequire(import.meta.url);
const {createMockNocoClient}=require('../web-console/backend/mock-data.ts');
const {createWebConsoleRepository}=require('../web-console/backend/repository.ts');
const {createWebConsoleApp}=require('../web-console/backend/app.ts');
const express=require('express') as typeof import('express');
export async function createConsoleFixture(leaseMs=45_000, now=Date.now, passwordBridge?: BridgeConfig) {
  const noco=createMockNocoClient(), clients=await noco.fetchRecords('mxza381054ldlza');
  for(const [id,name] of [[901,'Alex'],[902,'Bob']] as const) clients.push({Id:id,first_name:name,last_name:'OctoTest',
    client_name:name,fio:`${name} OctoTest`,calendar_email:`${name.toLowerCase()}.octo@example.com`,market:'Ru',
    rel_clients_primary_stack:{Id:14,name:'REACT'},telegram_general_chat_id:`octo-test-${id}`,client_status:'paused'});
  const repository=createWebConsoleRepository({nocoClient:noco}),store=createMemoryStore();
  let listenerOptions: ActionLogOptions|undefined;
  const cloud=createMockCloud({...store,recordPage:page=>listenerOptions?listenerOptions.onPage(page):store.recordPage(page)},now);
  const config={...structuredClone(testConfig),leaseMs};
  const runtime=createOctoRuntime({store,api:cloud.api,config,token:'mock-only',getClient:id=>repository.getClientById(id),now,passwordBridge,
    listen:options=>{listenerOptions=options;let connected=false;return {start(){connected=true;},async stop(){connected=false;},
      status(){return {connected,reconnects:0,lastSafeError:undefined,checkpoint:connected?0:undefined};}};}});
  const app=withBridgeRoutes(createWebConsoleApp({useMockData:true,repository,octoService:runtime.service}),
    passwordBridge ? bridgeRoutes(createBridgeBroker({store,api:cloud.api,config,bridge:passwordBridge,now,
      checkpoint:()=>runtime.bridgeCheckpoint()}),passwordBridge) : undefined);
  app.use(express.static(resolve('dist/web-console')));
  app.use((req:import('express').Request,res:import('express').Response)=>{
    if(req.path.startsWith('/api'))res.status(404).json({error:'not_found'});
    else res.sendFile(resolve('dist/web-console/index.html'));
  });
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(done=>server.once('listening',done));
  await runtime.start();
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  return {url,store,cloud,runtime,config, async close(){await runtime.stop();await new Promise<void>(done=>server.close(()=>done()));}};
}
