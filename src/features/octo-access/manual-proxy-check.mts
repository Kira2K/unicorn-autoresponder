import {isIP} from 'node:net';
import {createHash} from 'node:crypto';
import {OctoError} from './contracts.mts';
import type {ProxyInput} from './contracts.mts';
export interface ProxyConnectivityResult{ok:boolean;exit_ip?:string|null;country?:string|null}

export function manualProxyFingerprint(input:ProxyInput){
 return createHash('sha256').update(JSON.stringify([input.type,input.host.toLowerCase(),input.port,input.login,input.password])).digest('hex');
}
export function manualProxyUrl(input:ProxyInput){
 const host=input.host.includes(':')&&!input.host.startsWith('[')?`[${input.host}]`:input.host;
 return `${input.type==='socks5'?'socks5h':input.type}://${encodeURIComponent(input.login)}:${encodeURIComponent(input.password)}@${host}:${input.port}`;
}
/** Connection evidence only: reputation scores do not gate the student's own proxy. */
export async function checkManualProxy(input:ProxyInput,check:(uri:string)=>Promise<ProxyConnectivityResult>,now=Date.now){
 const result=await check(manualProxyUrl(input));
 if(!result.ok||!result.exit_ip||!isIP(result.exit_ip))
  throw new OctoError('octo_proxy_check_failed',422);
 return{fingerprint:manualProxyFingerprint(input),exitIp:result.exit_ip,...(result.country?.trim()?{country:result.country.trim()}:{}),checkedAt:now()};
}
