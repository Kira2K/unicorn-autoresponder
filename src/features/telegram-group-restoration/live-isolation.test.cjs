const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('independent batch state and injected sender leave previous batch untouched',async()=>{
 const runnerPath=require.resolve('./runner.cjs');require(runnerPath);const original=require.cache[runnerPath].exports;
 require.cache[runnerPath].exports={...original,runJob:async(plan,state,a)=>{state.channel={id:'1',accessHash:'1'};state.deliveries={example:{done:true,result:await a.send({text:'test'})}};state.completedAt='test';await a.save();}};
 delete require.cache[require.resolve('./live.cjs')];const {restore,FOLDER}=require('./live.cjs');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'veu-additional-isolation-'));fs.writeFileSync(path.join(folder,'settings.json'),JSON.stringify({sender:'bot'}));
 const oldFile=path.join(FOLDER,'client-242.json'),before=fs.existsSync(oldFile)?fs.readFileSync(oldFile,'utf8'):null;
 try{const state=await restore({clientId:'242',sourceChatId:'-1001',planHash:'isolated',operations:[{text:'test'}]}, {restorationOwnerId:'8805256389'},null,null,{folder,sendOperation:async(op,s)=>{assert.equal(s.clientId,'242');return{messageId:5,senderId:'343610488'};}});assert.equal(state.deliveries.example.result.senderId,'343610488');assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'client-242.json'))).sourceChatId,'-1001');assert.equal(fs.existsSync(oldFile)?fs.readFileSync(oldFile,'utf8'):null,before);}
 finally{require.cache[runnerPath].exports=original;}
});
