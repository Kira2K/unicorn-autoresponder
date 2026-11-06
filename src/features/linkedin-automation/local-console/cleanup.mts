import {createPostgresPool} from '../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import {createReadSession} from '../../../integrations/postgres/read-session.mts';
import {writeTransaction} from '../../../integrations/postgres/working-session.mts';
import {createCloudApi} from '../../octo-access/cloud-api.mts';
import {createOctoApi} from '../../octo-access-test/octo-api.mts';
import {assertFixture,fixtureEmail} from '../../web-console/e2e/linkedin-full-cycle/contracts.mts';
import type {ManagedProfile} from '../../octo-access/contracts.mts';
const args=process.argv.slice(2),runId=args.includes('--run-id')?args[args.indexOf('--run-id')+1]:'20261106-local',apply=args.includes('--apply');
if(!/^[a-z0-9-]{8,64}$/.test(runId))throw Error('linkedin_local_invalid_run_id');
const config=readPostgresAppDbConfig(process.env),pool=createPostgresPool(config),read=createReadSession(pool,config.database);
try{
  const ids=await read(async s=>{const ids:number[]=[];for(const kind of ['auto','manual'] as const){const row=(await s.query('SELECT * FROM noco.clients WHERE lower(calendar_email)=$1',[fixtureEmail(runId,kind)])).rows[0];if(!row)continue;assertFixture(row,runId,kind);ids.push(Number(row.id));}return ids;});
  const rows=await read(async s=>(await s.query('SELECT profile_id,state FROM noco.octo_profiles WHERE client_id=ANY($1::bigint[])',[ids])).rows);
  const cloud=createCloudApi(process.env.OCTO_API_TOKEN!),raw=createOctoApi(process.env.OCTO_API_TOKEN!,fetch,{cloudOnly:true}),uuids:string[]=[];
  for(const row of rows){const p=row.state as ManagedProfile;
    if(!p.uuid||p.pending||p.grant&&p.grant.phase!=='complete'||p.proxyChange&&p.proxyChange.phase!=='complete')throw Error('linkedin_local_close_and_finish_first');
    if(!(await cloud.profileExists(p.uuid)))continue;
    const live=await cloud.getProfile(p.uuid);
    if(live.status!==0||live.title!==p.original.title||live.description!==p.original.description||live.has_user_password)throw Error('linkedin_local_profile_not_idle');
    uuids.push(p.uuid);
  }
  if(apply){
    if(uuids.length){try{const result=await raw.cloudRequest('/profiles','DELETE',{uuids,skip_trash_bin:false});if(result.active_uuids?.length)throw Error('linkedin_local_profile_not_idle');}catch{/* Reconcile the one attempt below; never replay an uncertain delete. */}
      for(const uuid of uuids)if(await cloud.profileExists(uuid))throw Error('linkedin_local_cleanup_outcome_unknown');}
    const until=Date.now()+180000;while(await read(async s=>(await s.query('SELECT profile_id FROM noco.octo_profiles WHERE client_id=ANY($1::bigint[]) LIMIT 1',[ids])).rows.length>0)){
      if(Date.now()>until)throw Error('linkedin_local_worker_cleanup_pending');await new Promise(r=>setTimeout(r,2000));
    }
    await writeTransaction(pool,config.database,async s=>{
      for(const kind of ['auto','manual'] as const){const row=(await s.query('SELECT * FROM noco.clients WHERE lower(calendar_email)=$1 FOR UPDATE',[fixtureEmail(runId,kind)])).rows[0];if(row)assertFixture(row,runId,kind);}
      await s.query('UPDATE noco.platform_accounts SET __nc_deleted=true,password=NULL WHERE clients_id=ANY($1::bigint[])',[ids]);
      await s.query("UPDATE noco.linkedin_proxy_move SET data=data-'previousProxy' WHERE client_id=ANY($1::bigint[])",[ids]);
      await s.query('UPDATE noco.clients SET __nc_deleted=true WHERE id=ANY($1::bigint[])',[ids]);
    });
  }
  console.log(JSON.stringify({runId,applied:apply,clients:ids,profiles:rows.length,archived:apply,historyPreserved:true}));
}catch(error){const message=String((error as Error).message);console.error(/^linkedin_local_[a-z_]+$/.test(message)?message:'linkedin_local_cleanup_failed');process.exitCode=1;}finally{await pool.end();}
