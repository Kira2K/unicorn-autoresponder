import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {IntakeError} from '../console-intake/contracts.mts';
import {parseProxyInput} from '../../octo-access/proxy-input.mts';
import type {ProxyInput} from '../../octo-access/contracts.mts';
export const proxyFingerprint=(p:ProxyInput)=>{
  const host=p.host.toLowerCase().replace(/\.$/,'').replace(/^\[|\]$/g,'');
  return createHash('sha256').update(JSON.stringify([
    p.type,isIP(host)?normalizedIp(host):host,p.port,p.login,p.password])).digest('hex');
};
export interface ProxyProof {fingerprint:string;exitIp:string;comparison:'different'|'skipped';baselineFingerprint?:string;baselineIp?:string;baselineConnection?:ProxyInput}
const normalizedIp=(ip:string)=>isIP(ip)===6?new URL(`http://[${ip}]`).hostname.slice(1,-1):ip;
/** Network reads only; caller must CAS the task/profile before queuing any external write. */
export async function validateNewProxy(input:unknown,old:ProxyInput|undefined,baseline:{baselineFingerprint?:string;baselineIp?:string},
  check:(p:ProxyInput)=>Promise<string>):Promise<{input:ProxyInput;proof:ProxyProof}> {
  const next=parseProxyInput(input),fingerprint=proxyFingerprint(next);
  const baselineFingerprint=baseline.baselineFingerprint || (old&&proxyFingerprint(old));
  if(fingerprint===baselineFingerprint)throw new IntakeError('linkedin_task_proxy_reused',409);
  let exitIp:string;
  try{exitIp=await check(next);}catch{throw new IntakeError('linkedin_task_proxy_check_failed',502);}
  if(!isIP(exitIp))throw new IntakeError('linkedin_task_proxy_check_failed',502);
  exitIp=normalizedIp(exitIp);
  let baselineIp=baseline.baselineIp;
  if(!baselineIp&&old)try{const ip=await check(old);if(isIP(ip))baselineIp=ip;}catch{/* Unknown old IP is explicitly allowed. */}
  if(baselineIp)baselineIp=normalizedIp(baselineIp);
  if(baselineIp===exitIp)throw new IntakeError('linkedin_task_proxy_ip_reused',409);
  return{input:next,proof:{fingerprint,exitIp,baselineFingerprint,baselineIp,baselineConnection:old,comparison:baselineIp?'different':'skipped'}};
}
