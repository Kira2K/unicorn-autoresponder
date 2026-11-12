const {test}=require('node:test');
const assert=require('node:assert/strict');
const runtime=require('../orchestrator/runtime-utils.ts');
for(const url of ['about:blank','https://hh.ru/profile/resume/title']){
 test(`idle deadline terminates an open unsupported page: ${url}`,async()=>{
  const originalWait=runtime.wait,originalNow=Date.now;
  let clock=0;
  runtime.wait=async ms=>{clock+=ms;if(clock>10000)throw Error('idle deadline did not terminate the run')};
  Date.now=()=>clock;
  const modulePath=require.resolve('./control.ts');delete require.cache[modulePath];
  try{
   const page={isClosed:()=>false,url:()=>url,evaluate:()=>{throw Error('unsupported page must not be evaluated')}};
   const result=await require('./control.ts').waitForAutoResponderToFinish(page,undefined,()=>false,2000);
   assert.equal(result.idleTimedOut,true);
   assert.equal(result.timedOut,false);
   assert.equal(result.pageClosed,false);
   assert.equal(result.browserDisconnected,false);
   assert.equal(clock,2000);
  }finally{runtime.wait=originalWait;Date.now=originalNow;delete require.cache[modulePath]}
 });
}
test('a responder that finishes before the first watcher tick does not wait for the watch limit',async()=>{
 const originalWait=runtime.wait,originalNow=Date.now;let clock=0;
 runtime.wait=async ms=>{clock+=ms;if(clock>10000)throw Error('finished responder was not observed')};Date.now=()=>clock;
 const modulePath=require.resolve('./control.ts');delete require.cache[modulePath];
 try{
  const page={isClosed:()=>false,url:()=> 'https://hh.ru/search/vacancy',evaluate:async (_fn,keys)=>typeof keys==='string'&&keys==='hh_ar_v2_is_active'?false:undefined};
  const result=await require('./control.ts').waitForAutoResponderToFinish(page,120000,()=>false,600000);
  assert.equal(result.finished,true);assert.equal(result.idleTimedOut,false);assert.equal(result.timedOut,false);assert.equal(clock,3000);
 }finally{runtime.wait=originalWait;Date.now=originalNow;delete require.cache[modulePath]}
});
