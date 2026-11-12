const {test}=require('node:test'),assert=require('node:assert/strict');
const {checkServices}=require('./service-checks.cjs');
test('service checks report all independent failures without leaking credential-bearing exceptions',async()=>{
 const r=await checkServices([{name:'sql',run:async()=>{throw Error('postgres://password@host')}},{name:'dolphin',run:async()=>({idle:true})},{name:'recognizer',run:async()=>{throw Error('captcha_cli_missing')}}]);
 assert.equal(r.ok,false);assert.equal(r.checks.length,3);assert.equal(r.checks[0].code,'service_check_failed');assert.equal(r.checks[2].code,'captcha_cli_missing');assert.ok(!JSON.stringify(r).includes('password'));
});
test('an unresponsive check is aborted and cannot stall the first skill step',async()=>{
 let aborted=false;const r=await checkServices([{name:'model',timeoutMs:10,run:signal=>new Promise(()=>{signal.addEventListener('abort',()=>aborted=true)})}]);
 assert.equal(r.ok,false);assert.equal(aborted,true);assert.equal(r.checks[0].code,'service_check_timeout');
});
