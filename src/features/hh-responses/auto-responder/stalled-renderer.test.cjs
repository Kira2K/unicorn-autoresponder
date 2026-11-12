const {test}=require('node:test'),assert=require('node:assert/strict');
const {waitForAutoResponderToFinish}=require('./control.ts');
test('a renderer that never answers any progress read cannot defeat the wall-clock deadline',async()=>{
 const start=Date.now();let reads=0;
 const page={isClosed:()=>false,url:()=> 'https://hh.ru/search/vacancy',evaluate:()=>{reads++;return new Promise(()=>{})}};
 const result=await waitForAutoResponderToFinish(page,60,()=>false,600000);
 assert.equal(result.timedOut,true);assert.equal(result.finished,false);assert.ok(reads>=3);assert.ok(Date.now()-start<1500);
});
test('a renderer disconnect during bounded reads is returned as a client disconnect',async()=>{
 let disconnected=false;const page={isClosed:()=>false,url:()=> 'https://hh.ru/search/vacancy',evaluate:()=>new Promise(()=>{})};
 const timer=setTimeout(()=>{disconnected=true},20);
 try{const result=await waitForAutoResponderToFinish(page,60,()=>disconnected,600000);assert.equal(result.browserDisconnected,true);assert.equal(result.timedOut,false);}finally{clearTimeout(timer)}
});
