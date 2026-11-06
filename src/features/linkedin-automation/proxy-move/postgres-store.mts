import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../../integrations/postgres/working-session.mts';
import type { CopyDatabase,SqlPool,SqlSession } from '../../../integrations/postgres/contracts.mts';
import type { ManagedProfile } from '../../octo-access/contracts.mts';
import { canEditProxy } from '../../octo-access/proxy-workflow.mts';
import { fail, destination } from './contracts.mts';
import type { Move,MoveStore } from './contracts.mts';
export function createProxyMoveStore(pool:SqlPool,database:CopyDatabase):MoveStore {
  const read=createReadSession(pool,database);
  async function lock(s:SqlSession,move:Move,profile:ManagedProfile,checkCountry=false) {
    await s.query('SELECT pg_advisory_xact_lock(730644,$1::integer)',[move.clientId]);
    const client=(await s.query('SELECT ready_for_interview_in_english_in_2_months FROM noco.clients WHERE id=$1 AND NOT coalesce(__nc_deleted,false) FOR UPDATE',[move.clientId])).rows[0];
    if(!client)fail('binding_changed');
    if(checkCountry&&destination(client.ready_for_interview_in_english_in_2_months)!==move.country)fail('stale');
    const account=(await s.query(`SELECT a.id FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id
      WHERE a.clients_id=$1 AND lower(p.name)='linkedin' AND NOT coalesce(a.__nc_deleted,false)
      AND NOT coalesce(p.__nc_deleted,false) AND NOT coalesce(a.is_banned,false) FOR UPDATE OF a`,[move.clientId])).rows;
    if(account.length!==1||Number(account[0].id)!==move.accountId)fail('binding_changed');
    const row=(await s.query('SELECT revision,state FROM noco.octo_profiles WHERE profile_id=$1 AND client_id=$2 FOR UPDATE',[move.profileId,move.clientId])).rows[0];
    if(!row||Number(row.revision)!==profile.revision)fail('stale');
    const current=row.state as ManagedProfile;
    if(current.uuid!==move.profileUuid||current.locale!=='en'||!canEditProxy(current))fail('close_profile_first');
  }
  return {
    async checkSchema(){await read(async s=>{await s.query('SELECT id,data,notice_state FROM noco.linkedin_proxy_move LIMIT 0');});},
    read:(id,account)=>read(async s=>(await s.query('SELECT data FROM noco.linkedin_proxy_move WHERE client_id=$1 AND account_id=$2',[id,account])).rows[0]?.data as Move|undefined),
    begin:(move,profile,input)=>writeTransaction(pool,database,async s=>{
      await lock(s,move,profile,true);
      const prior=(await s.query('SELECT data FROM noco.linkedin_proxy_move WHERE client_id=$1 AND account_id=$2',[move.clientId,move.accountId])).rows[0]?.data as Move|undefined;
      if(prior){if(prior.fingerprint!==move.fingerprint)fail('already_started');return;}
      const state={...profile,revision:profile.revision+1,proxyChange:{id:move.id,phase:'queued',input,isMadeByExpert:false,title:`${profile.original.title} | ${profile.uuid}`.slice(0,255)}};
      await s.query('INSERT INTO noco.linkedin_proxy_move(id,client_id,account_id,profile_id,data) VALUES($1,$2,$3,$4,$5)',[move.id,move.clientId,move.accountId,move.profileId,JSON.stringify(move)]);
      await s.query('UPDATE noco.octo_profiles SET state=$2,revision=revision+1 WHERE profile_id=$1',[profile.id,JSON.stringify(state)]);
    }),
    finish:(move,profile,at)=>writeTransaction(pool,database,async s=>{
      await lock(s,move,profile);
      const row=(await s.query('SELECT data FROM noco.linkedin_proxy_move WHERE id=$1 FOR UPDATE',[move.id])).rows[0];
      if(!row)fail('not_started');
      const saved=row.data as Move;
      if(saved.phase==='completed')return saved;
      if(profile.proxyChange?.id!==move.id||profile.proxyChange.phase!=='complete'||profile.proxy?.uuid!==profile.proxyChange.uuid)fail('assignment_pending');
      const complete:Move={...saved,phase:'completed',completedAt:at,pauseUntil:new Date(Date.parse(at)+48*3600000).toISOString()};
      await s.query("UPDATE noco.linkedin_proxy_move SET data=$2,notice_state='pending' WHERE id=$1",[move.id,JSON.stringify(complete)]);
      return complete;
    })
  };
}
