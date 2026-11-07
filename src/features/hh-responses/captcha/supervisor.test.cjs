const {test}=require('node:test');const assert=require('node:assert/strict');
const {activeProfilePorts,createCaptchaSupervisor}=require('./supervisor.ts');
const started=(id,port)=>({kind:'client-lifecycle',clientName:'Fixture',dolphinProfileId:id,event:{event:'Dolphin profile started',details:'port '+port}});
test('scope is restricted to valid profiles started by this ledger and not finalized',()=>{
 const map=activeProfilePorts([started(1,3000),started(2,3001),started(3,99999),{kind:'client-final-status',status:{dolphinProfileId:1}}]);
 assert.deepEqual([...map.keys()],[2]);
});
test('unrelated browser tabs are never inspected; a scoped HH challenge is solved once',async()=>{
 let calls=0;const hh={url:()=> 'https://hh.ru/vacancy/1',evaluate:async()=>({panel:true,running:'1',count:4,captcha:true})};
 const other={url:()=> 'https://web.telegram.org/a/',evaluate:()=>assert.fail('unrelated tab inspected')};
 const supervisor=createCaptchaSupervisor({readRecords:()=>[started(2,3001)],chromium:{connectOverCDP:async()=>({isConnected:()=>true,contexts:()=>[{pages:()=>[other,hh]}]})},save:async()=>{},recognize:async()=>'',createAdapters:(page)=>{assert.equal(page,hh);return{}},solve:async()=>{calls++;return{solved:true,attempts:1}}});
 await supervisor.tick();assert.equal(calls,1);assert.equal(supervisor.state.active[0].id,2);assert.equal(supervisor.jobs.get(2).finished,true);
});

test('a failed capture is retried after a cooldown with a finite retry budget',async()=>{
 let calls=0;const page={url:()=> 'https://hh.ru/vacancy/1',evaluate:async()=>({panel:true,running:'1',captcha:true})};
 const supervisor=createCaptchaSupervisor({readRecords:()=>[started(2,3001)],chromium:{connectOverCDP:async()=>({isConnected:()=>true,contexts:()=>[{pages:()=>[page]}]})},save:async()=>{},recognize:async()=>'',createAdapters:()=>({}),solve:async()=>{calls++;return{solved:false,reason:'captcha_adapter_error'}}});
 await supervisor.tick();await supervisor.tick();assert.equal(calls,1);
 for(let i=0;i<3;i++){supervisor.jobs.get(2).finishedAt-=16000;await supervisor.tick()}
 assert.equal(calls,3);
});
