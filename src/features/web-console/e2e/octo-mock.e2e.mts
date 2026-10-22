import {createConsoleFixture} from '../../octo-access/console-fixture.mts';
import {runConsoleFlow} from './octo-console.e2e.mts';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
const require=createRequire(import.meta.url);
const {createAgent}=require('../../../../octo-bridge/agent.mjs');
const {openJournal}=require('../../../../octo-bridge/journal.mjs');
const bridge={id:'e2e-pc',ownerEmail:'owner@example.com',secret:'x'.repeat(48)};
const f=await createConsoleFixture(45_000,Date.now,bridge);
const directory=await mkdtemp(join(tmpdir(),'octo-bridge-console-'));
const journal=await openJournal(join(directory,'journal.json'),{backendUrl:f.url,bridgeId:bridge.id,ownerEmail:bridge.ownerEmail},'e2e-machine');
const cleared=new Set<string>();
const agent=createAgent({config:{backendUrl:f.url,bridgeId:bridge.id,secret:bridge.secret,
  ownerEmail:bridge.ownerEmail,allowedProfileUuids:[],allowAllManagedProfiles:true},journal,
  fetchImpl:async(input:string|URL,init?:RequestInit)=>{
    const url=new URL(String(input));
    if(url.origin===f.url)return fetch(input,init);
    assert.equal(url.origin,'http://127.0.0.1:58888');
    if(url.pathname==='/api/username')return Response.json({username:bridge.ownerEmail});
    if(url.pathname==='/api/profiles/active')return Response.json([...f.cloud.profiles.values()].filter(p=>p.status===1));
    assert.equal(url.pathname,'/api/profiles/password');assert.equal(init?.method,'DELETE');
    const body=JSON.parse(String(init?.body)),p=(await f.store.list()).find(p=>p.uuid===body.uuid);
    assert.ok(p?.grant?.id);assert.equal(p.password,body.password);assert.equal(p.grant.pending,'clear');
    assert.equal(p.grant.clearMethod,'bridge');assert.ok(!cleared.has(p.grant.id));
    const remote=f.cloud.profiles.get(p.uuid!)!;
    assert.equal(remote.status,0);assert.equal(remote.folder,f.config.homeFolder);
    assert.equal(remote.has_user_password,true);remote.has_user_password=false;cleared.add(p.grant.id);
    return Response.json({msg:'Profile password has been cleared'});
  }});
let stopping=false;
const worker=(async()=>{while(!stopping){
  try{await agent.step();}catch(error){const code=(error as {code?:string}).code;
    console.log(JSON.stringify({stage:'mock_bridge_retry',code:/^bridge_[a-z0-9_]+$/.test(code??'')?code:'bridge_e2e_failed'}));}
  await new Promise(done=>setTimeout(done,250));
}})();
try {
  const report=await runConsoleFlow({url:f.url,password:'1234',headful:false,outputDir:'tmp/octo-console-mock',driver:{kind:'mock',
    async beforeEnsure(){},async bind(){},
    async open(access){const p=await f.store.get(access.fixture.profileId);await f.cloud.start(p!.uuid!);},
    async afterExpiry(access){
      const p=await f.store.get(access.fixture.profileId),deadline=Date.now()+5_000;
      // UI hides credentials at the exact deadline; the in-process scheduler
      // confirms the cloud move on its next tick. Observe the same boundary as live E2E.
      do {
        const live=await f.cloud.api.getProfile(p!.uuid!);
        if(live.folder===f.config.homeFolder&&live.has_user_password&&live.status===1)return;
        await new Promise(done=>setTimeout(done,100));
      } while(Date.now()<deadline);
      throw new Error('mock_expiry_failed');
    },
    async stop(access){const p=await f.store.get(access.fixture.profileId);await f.cloud.stop(p!.uuid!);},
    async afterComplete(access){
      const p=await f.store.get(access.fixture.profileId);
      assert.equal(p?.grant?.bridgeClear?.result?.state,'succeeded');assert.equal(p.password,access.password);
    },async cleanup(){
      for(const p of await f.store.list())if(p.uuid&&f.cloud.profiles.get(p.uuid)?.status===1)await f.cloud.stop(p.uuid);
    }}});
  const bridgeResult={...report,bridge:{nativeClears:cleared.size,
    cloudClears:f.cloud.calls.filter(c=>c.startsWith('clear:')).length}};
  bridgeResult.passed=report.passed&&cleared.size===6&&bridgeResult.bridge.cloudClears===0;
  await writeFile('tmp/octo-console-mock/report.json',JSON.stringify(bridgeResult,null,2));
  console.log(JSON.stringify(bridgeResult));if(!bridgeResult.passed)process.exitCode=1;
}finally{
  stopping=true;await worker;await journal.close();await f.close();
  assert.equal(dirname(directory),tmpdir());assert.ok(basename(directory).startsWith('octo-bridge-console-'));
  await rm(directory,{recursive:true,force:true});
}
