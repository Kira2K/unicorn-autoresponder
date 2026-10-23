const {test}=require('node:test'),assert=require('node:assert/strict');
const {saveAtomic}=require('./atomic-json.cjs');
test('a transient Windows lock retries only journal rename and preserves complete data',()=>{
 let attempts=0,writes=0,stored,temporary;const waits=[];
 const io={mkdirSync(){},writeFileSync(f,v){writes++;temporary=v;},renameSync(){if(++attempts<3)throw Object.assign(Error(),{code:'EPERM'});stored=temporary;},unlinkSync(){throw Object.assign(Error(),{code:'ENOENT'});}};
 saveAtomic('/test/receipt.json',{messageId:42,done:true},{io,pause:ms=>waits.push(ms)});
 assert.equal(writes,1);assert.equal(attempts,3);assert.deepEqual(JSON.parse(stored),{messageId:42,done:true});assert.deepEqual(waits,[50,50]);
});
