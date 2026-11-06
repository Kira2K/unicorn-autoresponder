import {createPostgresPool} from '../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import {createReadSession} from '../../../integrations/postgres/read-session.mts';
import {createOctoPostgresStore} from '../../octo-access/postgres-store.mts';
import {createOctoApi} from '../../octo-access-test/octo-api.mts';
import {createProxyConnectivityCheck} from '../../octo-access/proxy-connectivity.mts';
import {manualProxyFingerprint} from '../../octo-access/manual-proxy-check.mts';
import {canEditProxy} from '../../octo-access/proxy-workflow.mts';
import {fixtureEmail,assertFixture} from '../../web-console/e2e/linkedin-full-cycle/contracts.mts';
import {writeTransaction} from '../../../integrations/postgres/working-session.mts';
import {randomUUID} from 'node:crypto';
import {unusedTestProxy} from './test-proxy.mts';
const args=process.argv.slice(2),runId=args.includes('--run-id')?args[args.indexOf('--run-id')+1]:'20261106-local',uuid=args.includes('--proxy-uuid')?args[args.indexOf('--proxy-uuid')+1]:'';
if(!/^[a-z0-9-]{8,64}$/.test(runId)||!/^[a-f0-9]{32}$/i.test(uuid))throw Error('linkedin_local_test_proxy_uuid_required');
const config=readPostgresAppDbConfig(process.env),pool=createPostgresPool(config),read=createReadSession(pool,config.database);
try{
  const client=await read(async s=>(await s.query('SELECT * FROM noco.clients WHERE lower(calendar_email)=$1',[fixtureEmail(runId,'auto')])).rows[0]);assertFixture(client,runId,'auto');
  const store=createOctoPostgresStore(pool,config.database),profiles=(await store.list(Number(client.id))).filter(p=>p.locale==='en');
  if(profiles.length!==1||!profiles[0].uuid)throw Error('linkedin_local_profile_not_ready');
  const p=profiles[0];if(p.proxy)throw Error('linkedin_local_initial_proxy_already_set');if(!canEditProxy(p))throw Error('linkedin_local_close_and_finish_first');
  const raw=createOctoApi(process.env.OCTO_API_TOKEN!,fetch,{cloudOnly:true}),all=await raw.cloudRequest('/proxies');
  const input=unusedTestProxy(all,uuid),fingerprint=manualProxyFingerprint(input);
  for(const profile of await store.list()){if(profile.proxyChange?.input&&manualProxyFingerprint(profile.proxyChange.input)===fingerprint)throw Error('linkedin_local_connection_reserved');}
  const checked=await createProxyConnectivityCheck()(input);if(!checked.ok||!checked.exit_ip)throw Error('linkedin_local_initial_proxy_not_working');
  const operationId=randomUUID();
  await writeTransaction(pool,config.database,async s=>{
    await s.query('SELECT pg_advisory_xact_lock(730644,$1::integer)',[p.clientId]);
    const row=(await s.query('SELECT * FROM noco.clients WHERE id=$1 FOR UPDATE',[p.clientId])).rows[0];assertFixture(row,runId,'auto');
    const state={...p,revision:p.revision+1,proxyChange:{id:operationId,phase:'queued',input,title:`${p.original.title} | ${p.uuid}`.slice(0,255),isMadeByExpert:true}};
    const saved=await s.query('UPDATE noco.octo_profiles SET state=$4,revision=revision+1 WHERE profile_id=$1 AND client_id=$2 AND revision=$3 RETURNING profile_id',[p.id,p.clientId,p.revision,JSON.stringify(state)]);
    if(saved.rows.length!==1)throw Error('linkedin_local_stale_profile');
  });
  console.log(JSON.stringify({runId,clientId:p.clientId,profileId:p.id,queued:true,operationId,connectionChecked:true}));
}catch(error){const code=String((error as Error).message);console.error(/^linkedin_local_[a-z_]+$/.test(code)?code:'linkedin_local_proxy_seed_failed');process.exitCode=1;}finally{await pool.end();}
