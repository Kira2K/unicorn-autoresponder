const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire,stripTypeScriptTypes}=require('node:module');
function fixture(busy){
 const file=path.resolve(__dirname,'../orchestrator/client-runner.ts'),real=createRequire(file),calls=[];
 const reporting={addLifecycleEvent:(s,_t,event,details)=>({...s,lifecycleEvents:[...(s.lifecycleEvents??[]),{event,details}]}),writeLocalRunLog:()=>{},sendClientLifecycleLog:async()=>{},sendClientErrorLog:async()=>{}};
 const dolphin={ensureAutomationLockStatusId:async()=>5,getDolphinProfile:async()=>({status:{id:busy?5:9},tags:busy?['Автоотклики, не трогай']:['keep']}),getDolphinProfileStatusId:p=>p.status.id,
   addDolphinProfileTag:async()=>calls.push('tag-add'),updateDolphinProfileStatus:async(_id,status)=>{calls.push('status-'+status);if(status===5)throw Error('status_write_uncertain');},
   removeDolphinProfileTag:async()=>calls.push('tag-remove'),stopDolphinProfile:async()=>calls.push('stop'),startDolphinProfile:async()=>assert.fail('profile must not start')};
 const module={exports:{}};vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync(file,'utf8')),{module,process,Error,console:{log(){},error(){}},setTimeout,clearTimeout,require:id=>id.endsWith('/dolphin/index.ts')?dolphin:id==='./reporting.ts'?reporting:real(id)});
 return {calls,run:()=>module.exports.runClientOrchestrator({clientName:'Fixture',market:'Ru',stack:'Stack',dolphinProfileId:12,commonChatId:'-100123',stackScenario:'https://hh.ru/search/vacancy'})};
}
test('a busy existing automation lock never causes stop or tag/status mutation',async()=>{
 const f=fixture(true);const result=await f.run();assert.match(result.error,/profile_lock_busy/);assert.deepEqual(f.calls,[]);
});
test('uncertain partial lock write arms the normal finally and restores the actual previous status',async()=>{
 const f=fixture(false);const result=await f.run();assert.match(result.error,/status_write_uncertain/);assert.deepEqual(f.calls,['tag-add','status-5','stop','tag-remove','status-9']);assert.equal(result.profileStatusRestored,true);
});
