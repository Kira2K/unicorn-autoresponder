import {randomUUID} from 'node:crypto';
import {createReadSession} from '../../../integrations/postgres/read-session.mts';
import {writeTransaction} from '../../../integrations/postgres/working-session.mts';
import {PostgresReadError} from '../../../integrations/postgres/contracts.mts';
import type {SqlPool,CopyDatabase} from '../../../integrations/postgres/contracts.mts';
import {canEditProxy} from '../../octo-access/proxy-workflow.mts';
import type {ManagedProfile,ProxyInput} from '../../octo-access/contracts.mts';
import type {CreationTask} from './contracts.mts';import type {ProxyProof} from './new-proxy.mts';
export function taskProxyStore(pool:SqlPool,database:CopyDatabase){
 const read=createReadSession(pool,database);
 return {
  read:(id:number)=>read(async s=>{const r=(await s.query('SELECT * FROM noco.linkedin_creation_proxy WHERE task_id=$1',[id])).rows[0];
    return r?{baselineUuid:r.baseline_uuid as string|undefined,baselineFingerprint:r.baseline_fingerprint as string|undefined,baselineIp:r.baseline_ip as string|undefined,
      baselineConnection:r.baseline_connection as ProxyInput|undefined,
      fingerprint:r.fingerprint as string|undefined,exitIp:r.exit_ip as string|undefined,operationId:r.operation_id as string|undefined,comparison:r.comparison as string|undefined}:undefined;}),
  async queue(task:CreationTask,profile:ManagedProfile,input:ProxyInput,proof:ProxyProof){
   return writeTransaction(pool,database,async s=>{
    await s.query('SELECT pg_advisory_xact_lock(730644,$1::integer)',[task.clientId]);
    await s.query('SELECT id FROM noco.clients WHERE id=$1 FOR UPDATE',[task.clientId]);
    const t=(await s.query('SELECT * FROM noco.linkedin_creation_task WHERE id=$1 AND client_id=$2 FOR UPDATE',[task.id,task.clientId])).rows[0];
    if(!t||Number(t.version)!==task.version||!['не начата','блок','сделана экспертом'].includes(String(t.status)))throw new PostgresReadError('linkedin_task_stale_version');
    const row=(await s.query("SELECT revision,state FROM noco.octo_profiles WHERE profile_id=$1 AND client_id=$2 AND locale='en' FOR UPDATE",[profile.id,task.clientId])).rows[0];
    const p=row?.state as ManagedProfile;
    if(!p||Number(row.revision)!==profile.revision||p.uuid!==profile.uuid||!canEditProxy(p))throw new PostgresReadError('linkedin_task_close_profile_first');
    const baseline=(await s.query('SELECT baseline_uuid FROM noco.linkedin_creation_proxy WHERE task_id=$1 FOR UPDATE',[task.id])).rows[0];
    if(!baseline||baseline.baseline_uuid&&baseline.baseline_uuid!==profile.proxy?.uuid) {
      // A completed prior attempt can be replaced, but its original baseline must remain stable.
      const previous=(await s.query('SELECT operation_id FROM noco.linkedin_creation_proxy WHERE task_id=$1',[task.id])).rows[0];
      if(!previous?.operation_id||previous.operation_id!==p.proxyChange?.id)throw new PostgresReadError('linkedin_task_proxy_changed');
    }
    const operationId=randomUUID();p.revision=Number(row.revision)+1;
    p.proxyChange={id:operationId,phase:'queued',input,isMadeByExpert:true,title:`${p.original.title} | ${p.uuid}`.slice(0,255)};
    await s.query('UPDATE noco.octo_profiles SET revision=revision+1,state=$2::jsonb WHERE profile_id=$1',[profile.id,JSON.stringify(p)]);
    const binding=await s.query("UPDATE noco.dolphin_profiles SET octo_profile_id=$2 WHERE id=$1 AND browser='octo' RETURNING id",[profile.id,p.uuid]);
    if(binding.rows.length!==1)throw new PostgresReadError('octo_binding_missing');
    await s.query(`UPDATE noco.linkedin_creation_proxy SET baseline_uuid=coalesce(baseline_uuid,$9),baseline_fingerprint=coalesce(baseline_fingerprint,$2),baseline_ip=coalesce(baseline_ip,$3),
      baseline_connection=coalesce(baseline_connection,$10::jsonb),fingerprint=$4,exit_ip=$5,comparison=$6,operation_id=$7,profile_id=$8 WHERE task_id=$1`,
      [task.id,proof.baselineFingerprint??null,proof.baselineIp??null,proof.fingerprint,proof.exitIp,proof.comparison,operationId,profile.id,profile.proxy?.uuid??null,
       proof.baselineConnection?JSON.stringify(proof.baselineConnection):null]);
    await s.query('UPDATE noco.linkedin_creation_task SET proxy_uuid=NULL,proxy_profile_id=NULL,proxy_saved_at=NULL WHERE id=$1',[task.id]);
    return{queued:true};
   });
  }
 };
}
