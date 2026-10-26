import type { SqlPool, SqlSession } from '../../postgres/contracts.mts';
import type { Client, DeliveryScope, State, Store } from './types.mts';
import { emptyState } from './types.mts';
import { assertStateMutation } from './state-contract.mts';
import { MARKET_OPTIONS } from './policy.mts';
import {assertPilotState,pilotChatSafe,pilotSchema} from './pilot-scope.mts';
import type {PilotScope} from './pilot-scope.mts';
const collections=['learners','sessions','checkins','deliveries','operations','history'] as const;
type Collection=typeof collections[number];
const json=(v:unknown)=>JSON.stringify(v);
export type DatabaseGate={database:string;environment:'local-test'|'release';pilot?:PilotScope};
export function mentorSchema(gate:DatabaseGate):string{
  if(gate.pilot&&gate.environment!=='local-test')throw new Error('mentor_pilot_environment');
  return gate.pilot?pilotSchema(gate.pilot):'mentor_bot';
}
export async function assertDatabase(session:SqlSession,gate:DatabaseGate):Promise<void> {
  const row=(await session.query('SELECT current_database() AS database, environment'+(gate.pilot?',binding':'')+
    ' FROM '+mentorSchema(gate)+'.runtime WHERE singleton')).rows[0];
  if(row?.database!==gate.database || row?.environment!==gate.environment)throw new Error('mentor_database_gate');
  if(gate.pilot&&row.binding!==gate.pilot.binding)throw new Error('mentor_pilot_binding');
}
/** Short, serializable aggregate transactions. External calls never run under this lock. */
export function postgresStore(pool:SqlPool,gate:DatabaseGate):Store {
  const schema=mentorSchema(gate),pilot=gate.pilot;
  const statusHistory=pilot?schema+'.status_history':'noco.client_status_history';
  async function databaseTransaction<T>(operation:(db:SqlSession)=>Promise<T>,readOnly=false):Promise<T>{
      const db=await pool.connect();let committing=false,broken=false;
      try{
        await db.query(readOnly?'BEGIN READ ONLY':'BEGIN READ WRITE');
        if(!readOnly)await db.query(pilot?'SELECT pg_advisory_xact_lock(85101,hashtext($1))':
          'SELECT pg_advisory_xact_lock(85101,1)',pilot?[schema]:[]);
        await assertDatabase(db,gate);
        const result=await operation(db);
        committing=true;await db.query('COMMIT');
        return result;
      }catch(cause){
        broken=true;try{await db.query('ROLLBACK');}catch{}
        throw new Error(committing?'mentor_commit_uncertain':'mentor_transaction_failed',{cause});
      }finally{db.release(broken);}
  }
  async function transaction<T>(operation:(state:State)=>T,scope?:DeliveryScope):Promise<T>{
    return databaseTransaction(async db=>{
        const state=emptyState();
        if(scope){
          const rows=(await db.query(scope.deliveryId===undefined ? `SELECT d.key,d.payload FROM ${schema}.deliveries d
            WHERE ((d.payload->>'state'='pending' AND (d.payload->>'retryAt')::numeric <= $1)
              OR (d.payload->>'state'='sending' AND COALESCE((d.payload->>'claimedAt')::numeric,0)+$2 <= $1))
              AND NOT EXISTS (SELECT 1 FROM ${schema}.learners l WHERE l.key=d.payload->>'clientId'
                AND l.payload ? 'syncError' AND d.payload ? 'relevance'
                AND COALESCE((d.payload->>'expiresAt')::numeric,$1+1)>$1)
            ORDER BY (d.payload->>'retryAt')::numeric,d.key LIMIT 100`:
            'SELECT key,payload FROM '+schema+'.deliveries WHERE key=$1',
            scope.deliveryId===undefined?[scope.now,scope.leaseMs]:[scope.deliveryId])).rows;
          for(const row of rows)state.deliveries[String(row.key)]=row.payload as State['deliveries'][string];
          const jobs=Object.values(state.deliveries);
          const keys={learners:jobs.flatMap(d=>d.clientId?[d.clientId]:[]),sessions:jobs.flatMap(d=>d.sessionId?[d.sessionId]:[]),
            checkins:jobs.flatMap(d=>d.checkinId?[d.checkinId]:[])};
          for(const table of ['learners','sessions','checkins'] as const){
            const ids=[...new Set(keys[table])];
            if(!ids.length)continue;
            const rows=(await db.query('SELECT key,payload FROM '+schema+'.'+table+' WHERE key=ANY($1::text[])',[ids])).rows;
            for(const row of rows)(state[table] as Record<string,unknown>)[String(row.key)]=row.payload;
          }
        }else{
          for(const table of collections){
            const rows=(await db.query('SELECT key,payload FROM '+schema+'.'+table)).rows;
            for(const row of rows)(state[table] as Record<string,unknown>)[String(row.key)]=row.payload;
          }
        }
        if(pilot)assertPilotState(state,pilot);
        const enrolled=Object.keys(state.learners);
        if(enrolled.length)await db.query('SELECT id FROM noco.clients WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',[enrolled]);
        const clients=scope&&!enrolled.length?[]:(await db.query(`SELECT c.id,c.client_name,c.telegram_personal_chat_id,c.client_status,c.market_id,
          c.telegram_general_chat_id,to_jsonb(c)->>'secured_general_chat_id' AS secured_general_chat_id,
          to_jsonb(c)->>'tg_hard_mentor' AS tg_hard_mentor,to_jsonb(c)->>'tg_soft_mentor' AS tg_soft_mentor,s.name AS stack_name
          FROM noco.clients c LEFT JOIN noco.stacks s ON s.id=c."01_stacks_id" AND NOT COALESCE(s.__nc_deleted,false)
          WHERE NOT COALESCE(c.__nc_deleted,false)`+(pilot?' AND c.id=$1':scope?' AND c.id=ANY($1::bigint[])':''),
          pilot?[pilot.clientId]:scope?[enrolled]:[])).rows;
        const str=(v:unknown)=>String(v??'').trim();
        for(const r of clients){
          const c:Client={id:str(r.id),name:str(r.client_name),username:str(r.telegram_personal_chat_id),
            chatId:str(r.secured_general_chat_id)||str(r.telegram_general_chat_id),status:str(r.client_status),
            market:(Object.keys(MARKET_OPTIONS) as (keyof typeof MARKET_OPTIONS)[]).find(key=>MARKET_OPTIONS[key].id===Number(r.market_id))??null,stack:str(r.stack_name),
            hardMentor:str(r.tg_hard_mentor),softMentor:str(r.tg_soft_mentor)};
          if(pilot){
            if(c.id!==pilot.clientId||!pilotChatSafe(c.chatId,pilot))throw new Error('mentor_pilot_source_binding');
            c.username='@'+pilot.studentUsername;
            c.chatId=pilot.chatId;
          }
          state.clients[c.id]=c;
        }
        if(pilot&&(!scope||enrolled.length)&&!state.clients[pilot.clientId])throw new Error('mentor_pilot_client_missing');
        if(!scope){
          const offset=(await db.query('SELECT update_offset FROM '+schema+'.runtime WHERE singleton')).rows[0];
          state.offset=Number(offset?.update_offset??0);
        }
        if(!scope&&enrolled.length){
          // No high-water mark: sequence allocation order is not transaction commit order.
          const from=Math.min(...Object.values(state.learners).map(l=>l.enabledAt));
          const rows=(await db.query(`SELECT h.id,h.client_id,h.old_status,h.new_status,h.changed_at
            FROM ${statusHistory} h
            LEFT JOIN ${schema}.operations o ON o.key='status:'||h.id::text
            WHERE h.client_id=ANY($1::bigint[]) AND h.changed_at >= $2 AND o.key IS NULL
            ORDER BY h.changed_at,h.id`,[enrolled,new Date(from)])).rows;
          state.sourceEvents=rows.map(r=>({id:str(r.id),clientId:str(r.client_id),oldStatus:str(r.old_status),newStatus:str(r.new_status),
            at:r.changed_at instanceof Date?r.changed_at.getTime():Date.parse(String(r.changed_at))}));
        }
        if(pilot)assertPilotState(state,pilot);
        const before=structuredClone(state);
        const result=operation(state);
        if(result && typeof (result as {then?:unknown}).then === 'function')throw new Error('mentor_async_transaction_forbidden');
        assertStateMutation(before,state);
        if(pilot)assertPilotState(state,pilot);
        for(const c of Object.values(state.clients)){
          const old=before.clients[c.id];if(!old)throw new Error('mentor_client_creation_forbidden');
          if(pilot&&JSON.stringify({...c,status:old.status,market:old.market,hardMentor:old.hardMentor,softMentor:old.softMentor})!==JSON.stringify(old))
            throw new Error('mentor_pilot_readonly_client_field');
          if(old.status!==c.status || old.market!==c.market || old.hardMentor!==c.hardMentor || old.softMentor!==c.softMentor){
            // Only these existing fields are owned by interactive business actions.
            const values:unknown[]=[c.id],assignments:string[]=[];
            const fields=[['status','client_status'],['market','market_id'],['hardMentor','tg_hard_mentor'],['softMentor','tg_soft_mentor']] as const;
            for(const [field,column] of fields)if(c[field]!==old[field]){
              values.push(field==='market'?(c.market?MARKET_OPTIONS[c.market].id:null):c[field]);assignments.push(column+'=$'+values.length);
            }
            const historyId=pilot&&old.status!==c.status?(await db.query(
              'SELECT COALESCE(max(id),0)::text AS id FROM '+statusHistory+' WHERE client_id=$1',[c.id])).rows[0]?.id:undefined;
            if(assignments.length){
              const updated=await db.query('UPDATE noco.clients SET '+assignments.join(',')+
                ' WHERE id=$1 AND NOT COALESCE(__nc_deleted,false) RETURNING id',values);
              if(updated.rows.length!==1||String(updated.rows[0].id)!==c.id)throw new Error('mentor_client_missing');
            }
            if(historyId!==undefined&&!(await db.query(`SELECT id FROM ${statusHistory}
              WHERE client_id=$1 AND id>$2::bigint AND COALESCE(old_status,'')=$3 AND new_status=$4`,
              [c.id,historyId,old.status,c.status])).rows.length)throw new Error('mentor_pilot_status_history_required');
          }
        }
        for(const table of collections)await saveCollection(db,schema,table,before[table],state[table]);
        if(state.offset!==before.offset)await db.query('UPDATE '+schema+'.runtime SET update_offset=$1 WHERE singleton',[state.offset]);
        return structuredClone(result);
    });
  }
  return {
    transaction,
    deliveryTransaction:(scope,operation)=>transaction(operation,scope),
    cursor:{
      read:()=>databaseTransaction(async db=>Number((await db.query('SELECT update_offset FROM '+schema+'.runtime WHERE singleton')).rows[0]?.update_offset??0),true),
      async advance(nextOffset){
        if(!Number.isSafeInteger(nextOffset)||nextOffset<0)throw new Error('mentor_offset_invalid');
        await databaseTransaction(async db=>{
          await db.query('UPDATE '+schema+'.runtime SET update_offset=GREATEST(update_offset,$1) WHERE singleton',[nextOffset]);
        });
      }
    }
  };
}
async function saveCollection(db:SqlSession,schema:string,table:Collection,before:Record<string,unknown>,after:Record<string,unknown>):Promise<void>{
  for(const [key,value] of Object.entries(after)){
    if(json(before[key])===json(value))continue;
    if(table==='history'&&before[key]!==undefined)throw new Error('mentor_history_immutable');
    const conflict=table==='history'?'':' ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload';
    await db.query('INSERT INTO '+schema+'.'+table+'(key,payload) VALUES($1,$2::jsonb)'+conflict,[key,json(value)]);
  }
  for(const key of Object.keys(before)){
    if(after[key]!==undefined)continue;
    if(table!=='sessions')throw new Error('mentor_history_delete_forbidden');
    await db.query('DELETE FROM '+schema+'.sessions WHERE key=$1',[key]);
  }
}
