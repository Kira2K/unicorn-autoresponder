import test from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{bridgeRoutes,bridgePath}from'./routes.mts';import{createBridgeBroker}from'./broker.mts';import{createMemoryStore,createMockCloud,testConfig}from'../testing.mts';
const express=createRequire(import.meta.url)('express')as typeof import('express');
test('server logs correlate bridge requests without credentials, arbitrary headers or raw error bodies',async()=>{
 const store=createMemoryStore(),cloud=createMockCloud(store),config={id:'pc',ownerEmail:'owner@example.invalid',secret:'SECRET'.repeat(9)},logs:Record<string,unknown>[]=[];
 const app=express();app.use(bridgePath,bridgeRoutes(createBridgeBroker({store,api:cloud.api,config:testConfig,bridge:config,checkpoint:async()=>0}),config,e=>logs.push(e)));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(done=>server.once('listening',done));const url='http://127.0.0.1:'+(server.address()as{port:number}).port;
 try{const requestId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';const response=await fetch(url+bridgePath+'/authorize',{method:'POST',headers:{authorization:'Bearer '+config.secret,'content-type':'application/json','x-octo-request-id':requestId},body:JSON.stringify({deviceId:'d'.repeat(64),id:'missing-grant'})});assert.equal(response.status,404);assert.equal(response.headers.get('x-octo-request-id'),requestId);
  assert.equal(logs.length,1);assert.equal(logs[0].grantId,'missing-grant');assert.equal(logs[0].requestId,requestId);assert.equal(logs[0].httpStatus,404);assert.equal(logs[0].outcome,'octo_bridge_task_not_found');
  await fetch(url+bridgePath+'/health',{headers:{authorization:'Bearer '+config.secret}});assert.equal(logs.length,1);
  await fetch(url+bridgePath+'/authorize',{method:'POST',headers:{authorization:'Bearer '+config.secret,'content-type':'application/json','x-octo-request-id':'SECRET'},body:JSON.stringify({password:'SECRET'})});assert.equal(logs.length,2);assert.ok(!JSON.stringify(logs).includes('SECRET'));
 }finally{await new Promise<void>(done=>server.close(()=>done()));}
});
