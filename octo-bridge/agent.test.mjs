import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, parseConfig } from './agent.mjs';
const uuid='a'.repeat(32),id='g-1',secret='s'.repeat(48);
const config={backendUrl:'http://127.0.0.1:4305',bridgeId:'owner-pc',secret,ownerEmail:'owner@example.com',allowedProfileUuids:[uuid],pollMilliseconds:2000};
const job={version:1,bridgeId:config.bridgeId,id,uuid,password:'03742',ownerEmail:config.ownerEmail,expiresAt:1000,hiddenAt:1001};
function setup() {
 const data={deviceId:'c'.repeat(64),entries:{}}, calls=[], receipts=[];
 let deleted=0,authorized=0,lostAck=false,localFailure=false,active=false,crashBeforeDelete=false,owner=config.ownerEmail,time=2000,authFailure;
 const logs=[];
 const journal={data,async save(){
  if(crashBeforeDelete&&data.entries[id]?.stage==='executing'){
   crashBeforeDelete=false;throw Error('simulated process interruption after durable executing state');
  }
 },async close(){}};
 const fetchImpl=async (url,init)=>{
  calls.push({url:String(url),init});const body=init?.body?JSON.parse(init.body):{};
  if(String(url).startsWith('http://127.0.0.1:58888')){
   assert.equal(new Headers(init?.headers).has('authorization'),false);
   if(String(url).endsWith('/username'))return Response.json({username:owner});
   if(String(url).endsWith('/active'))return Response.json(active?[{uuid}]:[]);
   assert.equal(init.method,'DELETE');assert.ok(String(url).endsWith('/api/profiles/password'));
   assert.deepEqual(body,{uuid,password:'03742'});deleted++;
   if(localFailure)throw Error('SECRET upstream failure');
   return Response.json({msg:'Profile password has been cleared'});
  }
  assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${secret}`);
  if(String(url).endsWith('/poll'))return Response.json({task:receipts.length?null:job});
  if(String(url).endsWith('/authorize')){authorized++;if(authFailure){const kind=authFailure;authFailure=undefined;if(kind==='network')throw Error('SECRET disconnected');return new Response('<html>SECRET</html>',{status:503,headers:{'content-type':'text/html'}});}return Response.json({authorized:true});}
  if(String(url).endsWith('/result')){if(lostAck){lostAck=false;throw Error('SECRET');}receipts.push(body.result);return Response.json({accepted:true});}
  throw Error('unexpected');
 };
 const make=()=>createAgent({config,journal,fetchImpl,now:()=>time,log:event=>logs.push(event)});
 return{data,calls,receipts,logs,make,tick(ms){time+=ms;},failAuthorization(kind){authFailure=kind;},get deleted(){return deleted;},get authorized(){return authorized;},
  loseAck(){lostAck=true;},failDelete(){localFailure=true;},crashBeforeDelete(){crashBeforeDelete=true;},
  running(){active=true;},wrongOwner(){owner='guest@example.com';}};
}
test('portable bridge touches only the three permitted localhost endpoints; lost result ack never repeats DELETE',async()=>{
 const s=setup();s.loseAck();await s.make().step().catch(()=>{});
 assert.equal(s.deleted,1);assert.equal(s.authorized,1);
 await s.make().step(); // Simulated agent restart, same durable journal.
 assert.equal(s.deleted,1);assert.equal(s.authorized,1);assert.deepEqual(s.receipts,[{state:'succeeded'}]);
 assert.ok(!JSON.stringify(s.data).includes('03742'));
});

test('lost/non-JSON authorization stays received and can recover across restart without a duplicate DELETE',async()=>{
 for(const kind of ['network','html']){
  const s=setup();s.failAuthorization(kind);const agent=s.make();await assert.rejects(agent.step());
  assert.equal(s.deleted,0);assert.equal(s.data.entries[id].stage,'received');assert.equal(s.data.entries[id].result,undefined);assert.deepEqual(s.receipts,[]);
  const requests=s.calls.length;assert.equal((await agent.step()).state,'retrying');assert.equal(s.calls.length,requests);
  await s.make().step();await s.make().step();assert.equal(s.deleted,1);assert.equal(s.authorized,2);assert.deepEqual(s.receipts,[{state:'succeeded'}]);
  const failure=s.logs.find(e=>e.operation==='authorize'&&e.outcome!=='ok');assert.ok(failure.requestId);assert.equal(failure.grantId,id);assert.equal(typeof failure.durationMs,'number');
  if(kind==='html'){assert.equal(failure.httpStatus,503);assert.equal(failure.responseType,'html');}
  assert.ok(!JSON.stringify(s.logs).includes('SECRET'));assert.ok(!JSON.stringify(s.logs).includes(secret));assert.ok(!JSON.stringify(s.logs).includes('03742'));
 }
});

test('diagnostic sink failure cannot change the one-shot password operation',async()=>{
 const s=setup();const agent=createAgent({config,journal:{data:s.data,async save(){}},fetchImpl:async(url,init)=>{
  if(String(url).endsWith('/username'))return Response.json({username:config.ownerEmail});
  if(String(url).endsWith('/active'))return Response.json([]);
  if(String(url).endsWith('/poll'))return Response.json({task:job});
  if(String(url).endsWith('/authorize'))return Response.json({authorized:true});
  if(String(url).endsWith('/result'))return Response.json({accepted:true});
  return Response.json({msg:'Profile password has been cleared'});
 },now:()=>2000,log(){throw Error('sink failed')}});
 assert.equal((await agent.step()).state,'succeeded');
});

test('backend transport diagnostics distinguish causes and retries back off to 30 seconds',async()=>{
 for(const [cause,reason]of [['ECONNRESET','connection_reset'],['ECONNREFUSED','connection_refused'],['ENOTFOUND','dns'],['ETIMEDOUT','timeout']]){
  let time=2000;const logs=[],agent=createAgent({config,journal:{data:{deviceId:'d'.repeat(64),entries:{}},async save(){}},now:()=>time,log:e=>logs.push(e),fetchImpl:async url=>{
   if(String(url).endsWith('/username'))return Response.json({username:config.ownerEmail});
   throw Object.assign(new Error('SECRET transport URL'),{cause:{code:cause}});
  }});
  let delay;for(let attempt=0;attempt<6;attempt++){
   await assert.rejects(agent.step(),error=>{delay=error.retryAfterMs;return error.code==='bridge_backend_outcome_unknown';});
   assert.equal((await agent.step()).state,'retrying');time+=delay;
  }
  assert.equal(delay,30000);assert.ok(logs.every(e=>e.transportReason===reason));assert.ok(!JSON.stringify(logs).includes('SECRET'));
 }
});
test('unknown Desktop write and a crash before acknowledgement stay uncertain across restarts',async()=>{
 for(const crash of [false,true]){
  const s=setup();
  if(crash){s.crashBeforeDelete();await assert.rejects(s.make().step());}else s.failDelete();
  await s.make().step();await s.make().step();
  assert.equal(s.deleted,crash?0:1);assert.equal(s.receipts[0].state,'uncertain');
 }
});
test('wrong owner or a running browser cannot authorize or delete anything',async()=>{
 for(const kind of ['owner','running']){
  const s=setup();kind==='owner'?s.wrongOwner():s.running();
  await s.make().step().catch(()=>{});assert.equal(s.deleted,0);assert.equal(s.authorized,0);
 }
});
test('URL/config/UUID/deadline gates reject arbitrary hosts, grants and endpoints',async()=>{
 for(const patch of [{backendUrl:'http://example.com'},{backendUrl:'https://user:pass@example.com'},
  {backendUrl:'https://example.com/?secret=bad'},{allowedProfileUuids:[]},{secret:'bad'}])
  assert.throws(()=>parseConfig({...config,...patch}));
 const s=setup();job.expiresAt=3000;
 try{await assert.rejects(s.make().step());assert.equal(s.deleted,0);assert.equal(s.authorized,0);}finally{job.expiresAt=1000;}
});
