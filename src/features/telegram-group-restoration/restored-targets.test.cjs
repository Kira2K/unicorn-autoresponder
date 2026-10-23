const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {collectTargets}=require('./restored-targets.cjs');
test('both batches preserve receipt identity and exclude skipped and unprepared groups',()=>{
 const files=new Map();for(const [folder,id,state] of [['group-restoration-v2','1',{chatId:'-1001',invitation:'saved',complete:true}],['additional','2',{chatId:'-1002',invitation:'saved',steps:{invite:{done:true}}}],['skipped','3',{chatId:'-1003',invitation:'saved',skipped:true}],['unprepared','4',{chatId:'-1004',invitation:'saved'}]]){files.set(path.join(folder,'plans.json'),[{clientId:id}]);files.set(path.join(folder,'client-'+id+'.json'),state);}
 const r=collectTargets(['group-restoration-v2','additional','skipped','unprepared'],p=>files.get(p));assert.deepEqual(r.map(r=>r.plan.clientId),['1','2']);assert.equal(r[1].stateFile,path.join('additional','client-2.json'));
});
