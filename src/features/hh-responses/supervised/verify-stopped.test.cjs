const {test}=require('node:test'),assert=require('node:assert/strict');
const {verifyStopped}=require('./verify-stopped.cjs');
test('waits for delayed registry removal without touching unrelated profiles',async()=>{
 let t=0,calls=0;
 const result=await verifyStopped([1],{now:()=>t,sleep:async ms=>{t+=ms},readRunning:async()=>++calls<3?{1:{},9:{}}:{9:{}}});
 assert.deepEqual(result,[]);assert.equal(calls,3);assert.equal(t,2000);
});
test('persistent own profile remains a blocker at the deadline',async()=>{
 let t=0;
 assert.deepEqual(await verifyStopped([1],{now:()=>t,sleep:async ms=>{t+=ms},timeoutMs:2000,readRunning:async()=>({1:{}})}),[1]);assert.equal(t,2000);
});
test('read failure cannot be mistaken for confirmed cleanup',async()=>{
 await assert.rejects(verifyStopped([1],{readRunning:async()=>{throw Error('API unavailable')}}),/API unavailable/);
});
