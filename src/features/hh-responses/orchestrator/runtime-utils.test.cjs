const {test}=require('node:test');const assert=require('node:assert/strict');
const {withTimeout}=require('./runtime-utils.ts');
test('an unresolved timeout cleanup cannot disable the original deadline',async()=>{
 let called=false;const started=Date.now();
 await assert.rejects(withTimeout(new Promise(()=>{}),10,'original deadline',()=>{called=true;return new Promise(()=>{})}),e=>e.code==='timeout'&&e.message==='original deadline');
 assert.equal(called,true);assert.ok(Date.now()-started<1000);
});
test('cleanup errors do not replace the original timeout',async()=>{
 await assert.rejects(withTimeout(new Promise(()=>{}),10,'original deadline',async()=>{throw Error('cleanup failed')}),/original deadline/);
});
