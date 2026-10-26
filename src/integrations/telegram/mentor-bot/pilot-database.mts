import {readFile} from 'node:fs/promises';
import type {CopyDatabase,SqlPool,SqlSession} from '../../postgres/contracts.mts';
import {assertCopyDatabase} from '../../postgres/read-session.mts';
import type {PilotScope} from './pilot-scope.mts';
import {pilotChatSafe,pilotSchema} from './pilot-scope.mts';
import {assertDatabase} from './postgres-store.mts';

/** Inspect the canonical client and history, without overlaying or writing test identities. */
export async function inspectPilotClient(db:Pick<SqlSession,'query'>,scope:PilotScope){
  const rows=(await db.query(`SELECT c.id,c.client_name,c.client_status,c.market_id,
    COALESCE(NULLIF(btrim(to_jsonb(c)->>'secured_general_chat_id'),''),btrim(c.telegram_general_chat_id::text)) AS chat_id
    FROM noco.clients c WHERE c.id=$1 AND NOT COALESCE(c.__nc_deleted,false)`,[scope.clientId])).rows;
  if(rows.length!==1||String(rows[0].id)!==scope.clientId)throw new Error('mentor_pilot_client_missing');
  const c=rows[0];
  const historyTable=pilotSchema(scope)+'.status_history';
  const historyAvailable=(await db.query('SELECT to_regclass($1) IS NOT NULL AS prepared',[historyTable])).rows[0]?.prepared===true;
  const history=historyAvailable?(await db.query(`SELECT id,old_status,new_status,changed_at FROM ${historyTable}
    WHERE client_id=$1 ORDER BY id DESC LIMIT 10`,[scope.clientId])).rows:[];
  return {clientId:scope.clientId,clientName:String(c.client_name??''),sourceStatus:String(c.client_status??''),
    marketId:c.market_id,sourceChatId:String(c.chat_id??''),chatSafe:pilotChatSafe(String(c.chat_id??''),scope),
    usingTestChat:scope.useTestChat===true,
    historyTable,historyAvailable,history};
}

export async function readPilotStatus(pool:SqlPool,database:CopyDatabase,scope:PilotScope){
  const db=await pool.connect();
  try{
    await db.query('BEGIN READ ONLY');await assertCopyDatabase(db,database);
    return await inspectPilotClient(db,scope);
  }finally{await db.query('ROLLBACK').catch(()=>{});db.release();}
}

/** No DDL, polling, messages, enrollment or status updates. */
export async function checkPilotDatabase(pool:SqlPool,database:CopyDatabase,scope:PilotScope){
  const schema=pilotSchema(scope),db=await pool.connect();
  try{
    await db.query('BEGIN READ ONLY');await assertCopyDatabase(db,database);
    const client=await inspectPilotClient(db,scope);
    const permissions=(await db.query(`SELECT
      has_column_privilege(current_user,'noco.clients','client_status','UPDATE') AND
      has_column_privilege(current_user,'noco.clients','market_id','UPDATE') AND
      has_column_privilege(current_user,'noco.clients','tg_hard_mentor','UPDATE') AND
      has_column_privilege(current_user,'noco.clients','tg_soft_mentor','UPDATE') AS can_update_client,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='noco.clients'::regclass
        AND NOT tgisinternal AND tgenabled IN ('O','A') AND (tgtype::integer & 16)<>0 AND tgname=$2) AS has_update_trigger,
      to_regclass($1) IS NOT NULL AS schema_prepared`,[schema+'.runtime','mentor_pilot_'+scope.clientId+'_status_history'])).rows[0];
    const prepared=permissions?.schema_prepared===true;
    if(prepared){
      await assertDatabase(db,{database,environment:'local-test',pilot:scope});
      // Validate reads, writes and scope constraints through the actual adapter at --start.
      for(const table of ['learners','sessions','checkins','deliveries','operations','history'])
        await db.query('SELECT key,payload FROM '+schema+'.'+table+' LIMIT 0');
    }
    return {...client,schema,schemaPrepared:prepared,canUpdateClient:permissions?.can_update_client===true,
      hasUpdateTrigger:permissions?.has_update_trigger===true,
      ready:prepared&&client.historyAvailable&&client.chatSafe&&permissions?.can_update_client===true&&permissions?.has_update_trigger===true};
  }finally{await db.query('ROLLBACK').catch(()=>{});db.release();}
}

/** Explicit setup only: isolated state and one client-bound trigger; never updates client rows. */
export async function preparePilotDatabase(pool:SqlPool,database:CopyDatabase,scope:PilotScope){
  const schema=pilotSchema(scope),db=await pool.connect();let committed=false;
  try{
    await db.query('BEGIN READ WRITE');await assertCopyDatabase(db,database);
    await db.query('SELECT pg_advisory_xact_lock(85101,hashtext($1))',[schema]);
    const client=await inspectPilotClient(db,scope);
    if(!client.chatSafe)throw new Error('mentor_pilot_source_binding');
    const prepared=(await db.query('SELECT to_regclass($1) IS NOT NULL AS prepared',[schema+'.runtime'])).rows[0]?.prepared===true;
    if(prepared)await assertDatabase(db,{database,environment:'local-test',pilot:scope});
    const permissions=(await db.query(`SELECT current_user AS app_role,
      has_database_privilege(current_user,current_database(),'CREATE') AND
      has_table_privilege(current_user,'noco.clients','TRIGGER')`+
      (prepared?' AND has_schema_privilege(current_user,$1,\'CREATE\')':'')+' AS can_prepare_direct',prepared?[schema]:[])).rows[0];
    const role=String(permissions?.app_role??'');
    if(!role)throw new Error('mentor_pilot_role_required');
    // Prefer the current role's existing DDL rights. Never grant or change role memberships.
    if(permissions?.can_prepare_direct!==true)await db.query('SET LOCAL ROLE unicorn_noco_copy_owner');
    const artifact=(await readFile(new URL('./001-mentor-bot.sql',import.meta.url),'utf8'))
      .replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'').replaceAll('mentor_bot',schema);
    await db.query(artifact);
    await db.query('ALTER TABLE '+schema+'.runtime ADD COLUMN IF NOT EXISTS binding text');
    // Retained for older pilot schemas; the SQL adapter uses canonical mentor columns.
    await db.query("ALTER TABLE "+schema+".runtime ADD COLUMN IF NOT EXISTS mentor_overrides jsonb NOT NULL DEFAULT '{}'::jsonb");
    // A dedicated trigger records only this client's real status changes; other rows never enter it.
    await db.query(`CREATE TABLE IF NOT EXISTS ${schema}.status_history(
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      client_id bigint NOT NULL CHECK(client_id=${scope.clientId}),old_status text,new_status text,
      changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE OR REPLACE FUNCTION ${schema}.record_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog AS $mentor_pilot$
      BEGIN
        INSERT INTO ${schema}.status_history(client_id,old_status,new_status) VALUES(NEW.id,OLD.client_status,NEW.client_status);
        RETURN NEW;
      END;
      $mentor_pilot$;
    REVOKE ALL ON FUNCTION ${schema}.record_status() FROM PUBLIC;
    DO $mentor_pilot_setup$
    BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='noco.clients'::regclass
        AND tgname='mentor_pilot_${scope.clientId}_status_history') THEN
        CREATE TRIGGER mentor_pilot_${scope.clientId}_status_history AFTER UPDATE OF client_status ON noco.clients
          FOR EACH ROW WHEN (NEW.id=${scope.clientId} AND OLD.client_status IS DISTINCT FROM NEW.client_status)
          EXECUTE FUNCTION ${schema}.record_status();
      END IF;
    END;
    $mentor_pilot_setup$;`);
    if(!prepared)await db.query('UPDATE '+schema+".runtime SET environment='local-test',binding=$1 WHERE singleton",[scope.binding]);
    const quotedRole='"'+role.replaceAll('"','""')+'"';
    await db.query('GRANT USAGE ON SCHEMA '+schema+' TO '+quotedRole);
    await db.query('GRANT SELECT,INSERT,UPDATE ON '+['learners','sessions','checkins','deliveries','operations']
      .map(t=>schema+'.'+t).join(',')+' TO '+quotedRole);
    await db.query('GRANT SELECT,INSERT ON '+schema+'.history TO '+quotedRole);
    await db.query('GRANT DELETE ON '+schema+'.sessions TO '+quotedRole);
    await db.query('GRANT SELECT ON '+schema+'.runtime TO '+quotedRole);
    await db.query('GRANT UPDATE(update_offset) ON '+schema+'.runtime TO '+quotedRole);
    await db.query('GRANT UPDATE(mentor_overrides) ON '+schema+'.runtime TO '+quotedRole);
    await db.query('GRANT SELECT ON '+schema+'.status_history TO '+quotedRole);
    await assertDatabase(db,{database,environment:'local-test',pilot:scope});
    await db.query('COMMIT');committed=true;
    return {schema,clientId:scope.clientId,prepared:true,clientRowsChanged:0};
  }finally{
    if(!committed)await db.query('ROLLBACK').catch(()=>{});
    db.release(!committed);
  }
}
