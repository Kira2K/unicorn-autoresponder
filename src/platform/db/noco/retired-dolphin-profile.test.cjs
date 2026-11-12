const {test}=require('node:test');
const assert=require('node:assert/strict');
const {findClientDolphinProfile}=require('./noco-db.ts');
const row=(Id,id,patch={})=>({Id,dolphin_profile_id:id,clients_id:35,locale:'En',browser:'dolphin',...patch});
test('a single runnable profile is selected beside retired placeholder rows',()=>{
 const valid=row(2,'\n700002');
 assert.equal(findClientDolphinProfile([row(1,'неактуально'),valid,row(3,'неактуально')],35,'Student','En'),valid);
});
test('two runnable profiles remain ambiguous even with retired rows',()=>{
 assert.throws(()=>findClientDolphinProfile([row(1,'неактуально'),row(2,'700002'),row(3,'700003')],35,'Student','En'),/ambiguous/);
});
test('a retired-only profile remains an invalid profile instead of a runnable target',()=>{
 assert.throws(()=>findClientDolphinProfile([row(1,'неактуально')],35,'Student','En'),/invalid dolphin_profile_id/);
});
test('a valid profile from another market or provider cannot replace an EN Dolphin row',()=>{
 assert.throws(()=>findClientDolphinProfile([row(1,'неактуально'),row(2,'700002',{locale:'Ru'}),row(3,'700003',{browser:'octo'})],35,'Student','En'),/invalid dolphin_profile_id/);
});
