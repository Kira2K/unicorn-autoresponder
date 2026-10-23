const {test}=require('node:test'),assert=require('node:assert/strict');
const {excludeGraduate,markSkipped,terminal,validateFinal}=require('./graduates.cjs');
test('graduates excluded except exact IDs 74 and 3; existing groups preserved',()=>{
 assert.equal(excludeGraduate('5','graduated'),true);for(const id of ['74','3'])assert.equal(excludeGraduate(id,'graduated'),false);
 for(const status of ['paused','studying','on en market'])assert.equal(excludeGraduate('5',status),false);
 const ready={clientId:'5',completedAt:'done'},created={clientId:'6',channel:{id:'1'}};
 assert.equal(markSkipped(ready,'graduated'),false);assert.equal(markSkipped(created,'graduated'),false);
 const s={clientId:'5'};assert.equal(markSkipped(s,'graduated',0),true);assert.equal(terminal(s),true);
 assert.throws(()=>markSkipped({clientId:'5',steps:{create:{intentAt:1}}},'graduated'),/reconciled/);
});
test('all 114 must be accounted for, excluded groups carry no invitations and are removed from delivery',()=>{
 const states=Array.from({length:114},(_,i)=>({clientId:String(i+100),completedAt:'done'}));
 states[0]={clientId:'5',skipped:true,skipReason:'graduated',checkedStatus:'graduated'};
 const included=validateFinal(states);assert.equal(included.length,113);assert.equal(included.some(s=>s.clientId==='5'),false);
 assert.throws(()=>validateFinal(states.slice(1)),/all_groups/);
 assert.throws(()=>validateFinal(states.map((s,i)=>i===1?states[0]:s)),/all_groups/);
 assert.throws(()=>validateFinal(states.map((s,i)=>i===0?{...s,clientId:'74'}:s)),/all_groups/);
 assert.throws(()=>validateFinal(states.map((s,i)=>i===0?{...s,checkedStatus:'paused'}:s)),/all_groups/);
});
