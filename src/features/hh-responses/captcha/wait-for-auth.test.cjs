const {test}=require('node:test');const assert=require('node:assert/strict');
const {waitForCaptchaAuth}=require('./wait-for-auth.ts');
test('keeps the auth page until captcha resolves; intermediate unknown is not success',async()=>{
 let time=0,calls=0;const initial={state:'captcha'};
 const result=await waitForCaptchaAuth({isClosed:()=>false},initial,{now:()=>time,sleep:async ms=>{time+=ms},detect:async()=>({state:++calls===1?'unknown':'logged_in'})});
 assert.equal(result.state,'logged_in');assert.equal(calls,2);
});
test('unresolved auth captcha has a finite deadline',async()=>{
 let time=0;const initial={state:'captcha'};
 const result=await waitForCaptchaAuth({isClosed:()=>false},initial,{timeoutMs:1000,now:()=>time,sleep:async ms=>{time+=ms},detect:async()=>initial});
 assert.equal(result,initial);assert.ok(time<=1000);
});
