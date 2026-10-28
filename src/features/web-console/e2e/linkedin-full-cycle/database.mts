import {createHash} from 'node:crypto';
import {writeTransaction} from '../../../../integrations/postgres/working-session.mts';
import {workingCrud} from '../../../../integrations/postgres/working-crud.mts';
import {createWorkingCatalog} from '../../../../integrations/postgres/working-catalog.mts';
import {assertFixture,fixtureEmail,fixtureMarker,fixtureNames} from './contracts.mts';
import type {CycleContext} from './context.mts';
import type {ManagedProfile} from '../../../octo-access/contracts.mts';
export async function ensureCycleClient(c:CycleContext,runId:string,kind:keyof typeof fixtureNames){
 return writeTransaction(c.pool,c.config.database,async s=>{
  await s.query('SELECT pg_advisory_xact_lock(730699,hashtext($1))',[fixtureMarker(runId,kind)]);
  const rows=(await s.query('SELECT * FROM noco.clients WHERE legend_info=$1 OR lower(calendar_email)=$2',[fixtureMarker(runId,kind),fixtureEmail(runId,kind)])).rows;
  if(rows.length>1)throw Error('e2e_fixture_collision');
  if(rows.length){assertFixture(rows[0],runId,kind);return Number(rows[0].id);}
  const catalog=createWorkingCatalog((await s.query("SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' OR definition ? 'sqlOnlyFor' ORDER BY id")).rows);
  const clients=catalog.list().filter(t=>t.title==='clients');if(clients.length!==1)throw Error('e2e_client_catalog_missing');
  const stack=(await s.query("SELECT id FROM noco.stacks WHERE lower(name)='java' AND NOT coalesce(__nc_deleted,false)")).rows;
  const market=(await s.query("SELECT id FROM noco.market WHERE lower(market)='en' AND NOT coalesce(__nc_deleted,false)")).rows;
  if(stack.length!==1||market.length!==1)throw Error('e2e_fixture_reference_ambiguous');
  const n=fixtureNames[kind];
  const row=await workingCrud(s,catalog).createRecord(clients[0].id,{client_name:`${n.first} ${n.last}`,first_name:n.first,last_name:n.last,
   calendar_email:fixtureEmail(runId,kind),telegram_general_chat_id:`NO-DELIVERY-E2E-${runId}-${kind}`,client_status:'paused',legend_info:fixtureMarker(runId,kind),stacks_id:stack[0].id,market_id:market[0].id});
  const id=Number(row.key[0]);
  await s.query("UPDATE noco.clients SET client_role='фейк' WHERE id=$1 AND legend_info=$2",[id,fixtureMarker(runId,kind)]);
  const check=(await s.query('SELECT * FROM noco.clients WHERE id=$1',[id])).rows[0];assertFixture(check,runId,kind);return id;
 });
}
export function cycleDatabase(c:CycleContext,runId:string,clientId:number){
 const owned=async()=>c.read(async s=>{const r=(await s.query('SELECT * FROM noco.clients WHERE id=$1',[clientId])).rows[0];if(!r)throw Error('e2e_fixture_missing');assertFixture(r,runId,'auto');return r;});
 return{
  async snapshot(){await owned();return c.read(async s=>({
   accounts:(await s.query('SELECT id,platforms_id,url,login,__nc_deleted,old_link_blocked FROM noco.platform_accounts WHERE clients_id=$1 ORDER BY id',[clientId])).rows,
   tasks:(await s.query('SELECT * FROM noco.linkedin_creation_task WHERE client_id=$1 ORDER BY id',[clientId])).rows,
   profiles:(await s.query('SELECT profile_id,locale,revision,state FROM noco.octo_profiles WHERE client_id=$1 ORDER BY locale',[clientId])).rows.map(p=>({profile_id:Number(p.profile_id),locale:String(p.locale),revision:Number(p.revision),state:p.state as ManagedProfile})),
   linklab:(await s.query('SELECT * FROM noco.linklab WHERE client_id=$1',[clientId])).rows[0],
   cycles:(await s.query('SELECT * FROM noco.linkedin_account_cycles WHERE client_id=$1 ORDER BY task_id',[clientId])).rows,
   notices:(await s.query('SELECT task_id,state,message_id FROM noco.linkedin_cycle_notifications WHERE client_id=$1 ORDER BY task_id',[clientId])).rows,
   proof:(await s.query('SELECT v.task_id,v.baseline_uuid,v.baseline_fingerprint,v.fingerprint,v.comparison,v.exit_ip,v.baseline_ip FROM noco.linkedin_creation_proxy v JOIN noco.linkedin_creation_task t ON t.id=v.task_id WHERE t.client_id=$1 ORDER BY t.id',[clientId])).rows
  }));},
  async confirm(taskId:number){await owned();return writeTransaction(c.pool,c.config.database,async s=>{
   await s.query('SELECT pg_advisory_xact_lock(730644,$1::integer)',[clientId]);await s.query('SELECT id FROM noco.clients WHERE id=$1 FOR UPDATE',[clientId]);
   const row=(await s.query('SELECT status FROM noco.linkedin_creation_task WHERE id=$1 AND client_id=$2 FOR UPDATE',[taskId,clientId])).rows[0];
   if(!row||!['сделана экспертом','выполнение подтверждено'].includes(String(row.status)))throw Error('e2e_task_not_confirmable');
   await s.query("UPDATE noco.linkedin_creation_task SET status='выполнение подтверждено' WHERE id=$1 AND client_id=$2",[taskId,clientId]);
  });},
  async profilePasswordHash(){await owned();return c.read(async s=>createHash('sha256').update(JSON.stringify((await s.query("SELECT locale,state->>'password' AS password FROM noco.octo_profiles WHERE client_id=$1 ORDER BY locale",[clientId])).rows)).digest('hex'));}
 };
}
/** Counts are diagnostics only: never repair unrelated legacy rows as a side effect of a test. */
export async function globalCycleIntegrity(c:CycleContext){return c.read(async s=>(await s.query(`SELECT
 (SELECT count(*)::int FROM noco.linkedin_creation_task t LEFT JOIN noco.platform_accounts a ON a.id=t.linkedin_account_id LEFT JOIN noco.platform_accounts m ON m.id=t.outlook_account_id WHERE a.id IS NULL OR m.id IS NULL OR a.clients_id<>t.client_id OR m.clients_id<>t.client_id) AS invalid_task_ownership,
 (SELECT count(*)::int FROM noco.linklab l JOIN noco.platform_accounts a ON a.id=l.platform_account_id WHERE a.clients_id<>l.client_id) AS invalid_linklab_ownership,
 (SELECT count(*)::int FROM(SELECT client_id,locale FROM noco.octo_profiles GROUP BY 1,2 HAVING count(*)>1)x) AS duplicate_profile_locales,
 (SELECT count(*)::int FROM noco.linkedin_cycle_notifications n LEFT JOIN noco.linkedin_account_cycles c ON c.task_id=n.task_id WHERE c.task_id IS NULL OR c.client_id<>n.client_id OR c.account_id<>n.account_id) AS invalid_notification_binding`)).rows[0]);}
