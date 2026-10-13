import {createConsoleFixture} from '../../octo-access/console-fixture.mts';
import {runConsoleFlow} from './octo-console.e2e.mts';
const f=await createConsoleFixture();
try {
  const report=await runConsoleFlow({url:f.url,password:'1234',outputDir:'tmp/octo-console-mock',driver:{kind:'mock',
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
    async afterComplete(){},async cleanup(){
      for(const p of await f.store.list())if(p.uuid&&f.cloud.profiles.get(p.uuid)?.status===1)await f.cloud.stop(p.uuid);
    }}});
  console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
}finally{await f.close();}
