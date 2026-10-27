import type {CloudApi,ManagedProfile,ProxyInput} from '../../octo-access/contracts.mts';
import {parseProxyInput} from '../../octo-access/proxy-input.mts';
import {canEditProxy} from '../../octo-access/proxy-workflow.mts';
import {IntakeError} from '../console-intake/contracts.mts';
import {proxyFingerprint,validateNewProxy} from './new-proxy.mts';
import type {CreationTask} from './contracts.mts';import type {taskProxyStore} from './proxy-store.mts';
export function createNewTaskProxy(deps:{store:ReturnType<typeof taskProxyStore>;api:Pick<CloudApi,'readProfileProxy'>;check:(p:ProxyInput)=>Promise<string>}){
 async function ready(t:CreationTask,p:ManagedProfile){
  const v=await deps.store.read(t.id);
  return !!v?.fingerprint&&v.fingerprint!==v.baselineFingerprint&&!!v.exitIp&&['different','skipped'].includes(v.comparison||'')
    &&!!p.proxy&&p.proxy.uuid!==v.baselineUuid&&v.operationId===p.proxyChange?.id&&p.proxyChange?.phase==='complete';
 }
 async function assert(t:CreationTask,p:ManagedProfile){
  if(!await ready(t,p)||!p.uuid)throw new IntakeError('linkedin_task_new_proxy_required',409);
  const v=await deps.store.read(t.id),actual=await deps.api.readProfileProxy!(p.uuid);
  if(!actual.saved||actual.saved.uuid!==p.proxy?.uuid||proxyFingerprint(parseProxyInput(actual.saved))!==v?.fingerprint)
   throw new IntakeError('linkedin_task_proxy_changed',409);
 }
 return {ready,assert,async queue(t:CreationTask,p:ManagedProfile,raw:unknown){
  const v=await deps.store.read(t.id);if(!v||!p.uuid)throw new IntakeError('linkedin_task_new_proxy_required',409);
  const input=parseProxyInput(raw);
  if(v.operationId===p.proxyChange?.id&&v.fingerprint===proxyFingerprint(input))return{queued:true};
  if(!canEditProxy(p))throw new IntakeError('linkedin_task_close_profile_first',409);
  let old:ProxyInput|undefined=v.baselineConnection;
  if(!v.baselineFingerprint){
   if(!deps.api.readProfileProxy)throw new IntakeError('linkedin_task_proxy_capture_unavailable',503);
   try{
    const actual=await deps.api.readProfileProxy(p.uuid);
    if(v.baselineUuid&&actual.saved?.uuid!==v.baselineUuid)throw new IntakeError('linkedin_task_proxy_changed',409);
    const connection=actual.saved||actual.inline;if(connection)old=parseProxyInput(connection);
   }catch(error){
    // A newly provisioned EN profile may have no connection at all. Other read failures are not absence.
    if(v.baselineUuid||(error as {code?:string}).code!=='octo_proxy_required')throw error;
   }
  }
  const checked=await validateNewProxy(input,old,v,deps.check);
  return deps.store.queue(t,p,checked.input,checked.proof);
 }};
}
