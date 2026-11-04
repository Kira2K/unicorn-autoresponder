import test from 'node:test';import assert from 'node:assert/strict';
import {createAgent}from'../bridge/agent.mjs';import{createDrainingFetch}from'./requests.mjs';
test('Render transport retains diagnostic headers and recovers lost authorization without a repeated clear',async()=>{
 const backend='https://backend.example.invalid',uuid='a'.repeat(32),id='recovery',logs=[];
 const config={backendUrl:backend,bridgeId:'owner',secret:'s'.repeat(43),ownerEmail:'owner@example.invalid',allowedProfileUuids:[uuid]};
 const task={version:1,bridgeId:'owner',id,uuid,password:'03742',ownerEmail:config.ownerEmail,expiresAt:1,hiddenAt:2};
 const journal={data:{deviceId:'d'.repeat(64),entries:{}},async save(){}};let lost=true,done=false,clears=0;
 const network=createDrainingFetch(backend,async(url)=>{
  const path=new URL(url).pathname;if(path.endsWith('/username'))return Response.json({username:config.ownerEmail});
  if(path.endsWith('/active'))return Response.json([]);
  if(path.endsWith('/poll'))return Response.json({task:done?null:task});
  if(path.endsWith('/authorize')){if(lost){lost=false;return new Response('<html>SECRET</html>',{status:503,headers:{'content-type':'text/html'}});}return Response.json({authorized:true});}
  if(path.endsWith('/password')){clears++;return Response.json({msg:'Profile password has been cleared'});}
  if(path.endsWith('/result')){done=true;return Response.json({accepted:true});}throw Error('unexpected');
 });
 try{const make=()=>createAgent({config,journal,fetchImpl:network.fetch,now:()=>100,log:e=>logs.push(e)});await assert.rejects(make().step());assert.equal(clears,0);assert.equal(logs[0].httpStatus,503);assert.equal(logs[0].responseType,'html');await make().step();await make().step();assert.equal(clears,1);assert.equal(journal.data.entries[id].result.state,'succeeded');assert.ok(!JSON.stringify(logs).includes('SECRET'));assert.ok(!JSON.stringify(logs).includes(task.password));}
 finally{network.dispose();}
});
