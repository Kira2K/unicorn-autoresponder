import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { combinedFixture } from './combined-fixture.mts';
import { featureTestProviders } from './feature-test-providers.mts';
import { createSqlFeatureServices } from './feature-services.mts';
import { tableIds as t } from './tables.mts';
import { defaults } from '../../../linkedin-automation/post-writer/types.ts';

for (const cancel of [false,true]) test(`SQL Writer retains likes across restart; disable=${cancel}`, async () => {
  const f=combinedFixture(),p=featureTestProviders();
  const clients=new Set([7]);
  for(let i=1;i<=6;i++) {
    const client=7+i;clients.add(client);
    f.set(t.clients,client,{...f.rows.get(t.clients)!.get('7'),Id:client,client_name:`SQL ${client}`});
    f.set(t.accounts,200+i,{...f.rows.get(t.accounts)!.get('21'),Id:200+i,clients_id:client,
      unipile_account_id:`fake-${i}`,linkedin_verified_provider_id:`provider-${i+1}`});
    f.set(t.profiles,300+i,{clients_id:client,locale:'En',dolphin_profile_id:`700${i}`});
  }
  const grant={...f.grant,clientIds:clients};
  let services=await createSqlFeatureServices(f.db,grant,p.providers);
  const step=async()=>{p.advance(6000);await services.postWriter.tick();for(let i=0;i<30;i++)await setImmediate();};
  const state=async()=>(await services.postWriter.get(21)).runs[0];
  try {
    await services.postWriter.update(21,{...defaults(21),likes:true});
    await services.postWriter.start(21,'automatic','sql-likes');
    for(let i=0;i<15&&p.metrics.likes===0;i++)await step();
    assert.equal(p.metrics.likes,1);assert.equal((await state()).status,'published');
    const selected=(await state()).engagement.items.map(x=>x.account.verifiedProviderId);
    assert.equal(new Set(selected).size,6);
    await services.close();services=await createSqlFeatureServices(f.db,grant,p.providers);
    if(cancel)await services.postWriter.update(21,{...defaults(21),likes:false});
    for(let i=0;i<25;i++)await step();
    assert.deepEqual((await state()).engagement.items.map(x=>x.account.verifiedProviderId),selected);
    assert.equal((await state()).engagement.status,cancel?'cancelled':'completed');
    assert.equal(p.metrics.likes,cancel?1:6);assert.equal(p.metrics.publishes,1);
    assert.equal((await state()).status,'published');
  } finally {await services.close();}
});
