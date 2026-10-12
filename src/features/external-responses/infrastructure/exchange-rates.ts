import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {atomicJson} from './store.ts'
import type {ExchangeRates} from '../stack_classification/salary.ts'

export const ECB_RATES_URL='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'
type Snapshot={version:1;status:'available'|'unavailable';retrievedAt:string;rates?:ExchangeRates;reason?:string}
const day=(at:Date)=>at.toISOString().slice(0,10)
function usable(rates:ExchangeRates|undefined,now:Date){
  if(!rates?.source||!/^\d{4}-\d{2}-\d{2}$/.test(rates.asOf)||!rates.usdPerUnit||typeof rates.usdPerUnit!=='object')return false
  const at=Date.parse(rates.asOf+'T00:00:00Z'),age=Date.parse(day(now))-at
  return Number.isFinite(at)&&new Date(at).toISOString().startsWith(rates.asOf)&&age>=0&&age<=7*86400000&&Object.entries(rates.usdPerUnit).length>0&&Object.entries(rates.usdPerUnit).every(([c,v])=>/^[A-Z]{3}$/.test(c)&&Number.isFinite(v)&&v>0)
}
export function parseEcbRates(xml:string,now=new Date()):ExchangeRates {
  const asOf=/<Cube\s+time=['"]([^'"]+)['"]/.exec(xml)?.[1],quotes=new Map<string,number>()
  for(const match of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([^'"]+)['"]\s*\/>/g)){
    const rate=Number(match[2]);if(quotes.has(match[1])||!Number.isFinite(rate)||rate<=0)throw Error('exchange_rates_invalid_feed')
    quotes.set(match[1],rate)
  }
  const usd=quotes.get('USD');if(!asOf||!usd)throw Error('exchange_rates_invalid_feed')
  const rates={asOf,source:ECB_RATES_URL,usdPerUnit:{EUR:usd,...Object.fromEntries([...quotes].map(([code,rate])=>[code,usd/rate]))}}
  if(!usable(rates,now))throw Error('exchange_rates_stale_or_invalid')
  return rates
}
async function load(path:string):Promise<Snapshot|undefined>{
  try{const value=JSON.parse(await readFile(path,'utf8'));if(value.version!==1||!['available','unavailable'].includes(value.status)||!Number.isFinite(Date.parse(value.retrievedAt))||value.status==='available'&&!usable(value.rates,new Date(value.retrievedAt))||value.status==='unavailable'&&value.rates)throw Error('exchange_rates_snapshot_invalid');return value}
  catch(error:any){if(error.code==='ENOENT')return;throw error}
}

/** One public read per UTC day, shared by serialized scans; freeze the exact result per run. No AI. */
export async function resolveScanExchangeRates(input:{runDirectory:string;cachePath:string;resume?:boolean;manual?:ExchangeRates},deps:{fetchImpl?:typeof fetch;now?:()=>Date;signal?:AbortSignal}={}) {
  const now=deps.now?.()??new Date(),path=join(input.runDirectory,'exchange-rates.snapshot.json')
  // Explicit input retains its existing contract and is bound by the scan configuration hash.
  if(input.manual)return {rates:input.manual,mode:'manual' as const}
  const frozen=await load(path)
  if(frozen){if(frozen.rates&&!usable(frozen.rates,now))throw Error('exchange_rates_run_snapshot_stale_start_new_run');return {...frozen,mode:'run_snapshot' as const}}
  // Historical runs had no automatic FX binding. Never change their scope on resume.
  if(input.resume)return {mode:'legacy_resume' as const,reason:'No automatic exchange-rate snapshot in this historical run'}
  const cached=await load(input.cachePath)
  if(cached&&day(new Date(cached.retrievedAt))===day(now)&&(!cached.rates||usable(cached.rates,now))){await atomicJson(path,cached);return {...cached,mode:'daily_cache' as const}}
  let snapshot:Snapshot
  try{
    deps.signal?.throwIfAborted()
    const response=await (deps.fetchImpl??fetch)(ECB_RATES_URL,{redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(10000),...(deps.signal?[deps.signal]:[])])})
    if(!response.ok)throw Error('exchange_rates_http_'+response.status)
    if(!response.body)throw Error('exchange_rates_empty_feed')
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>65536)throw Error('exchange_rates_response_too_large');chunks.push(part.value)}}finally{await reader.cancel().catch(()=>{})}
    snapshot={version:1,status:'available',retrievedAt:now.toISOString(),rates:parseEcbRates(Buffer.concat(chunks).toString('utf8'),now)}
  }catch(error:any){deps.signal?.throwIfAborted();snapshot={version:1,status:'unavailable',retrievedAt:now.toISOString(),reason:/^exchange_rates_[a-z0-9_]+$/.test(error.message??'')?error.message:'exchange_rates_transport_unavailable'}}
  await atomicJson(input.cachePath,snapshot);await atomicJson(path,snapshot)
  return {...snapshot,mode:'fetched' as const}
}
