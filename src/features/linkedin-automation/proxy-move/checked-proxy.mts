import {isIP} from 'node:net';
import {OctoError} from '../../octo-access/contracts.mts';
import type {ProxyInput} from '../../octo-access/contracts.mts';
import {checkedCountry} from './contracts.mts';
import type {Country,ProxyProof} from './contracts.mts';
type Result={ok:boolean;exit_ip?:string|null;country?:string|null};
const displayCountry=(value:unknown)=>{
 const normalized=checkedCountry(value);if(normalized)return normalized;
 return typeof value==='string'&&/^[\p{L} .()-]{1,80}$/u.test(value.trim())?value.trim():undefined;
};
/** The injected existing checker performs network I/O; this module never persists or assigns. */
export async function checkMoveProxy(input:ProxyInput,expected:Country,check:(p:ProxyInput)=>Promise<Result>,now=Date.now):Promise<ProxyProof>{
 let result:Result;
 try{result=await check(input);}catch{throw new OctoError('linkedin_proxy_move_check_failed',409);}
 if(!result.ok||!result.exit_ip||!isIP(result.exit_ip))throw new OctoError('linkedin_proxy_move_check_failed',409);
 if(checkedCountry(result.country)!==expected)throw new OctoError('linkedin_proxy_move_country_mismatch',409,
  {exitIp:result.exit_ip,expectedCountry:expected,...(displayCountry(result.country)?{actualCountry:displayCountry(result.country)}:{})});
 return{exitIp:result.exit_ip,country:expected,checkedAt:new Date(now()).toISOString()};
}
/** Rebuild the public shape rather than forwarding provider diagnostics. */
export function publicCountryFailure(error:unknown):{expectedCountry:Country;actualCountry?:string;exitIp?:string}|undefined{
 const e=error as {code?:string;details?:Record<string,unknown>}|null;
 if(e?.code!=='linkedin_proxy_move_country_mismatch')return;
 const expected=checkedCountry(e.details?.expectedCountry);if(!expected)return;
 const actual=displayCountry(e.details?.actualCountry);
 const ip=e.details?.exitIp;
 return{expectedCountry:expected,...(actual?{actualCountry:actual}:{}),...(typeof ip==='string'&&isIP(ip)?{exitIp:ip}:{})};
}
