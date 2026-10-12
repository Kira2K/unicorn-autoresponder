import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseEcbRates,resolveScanExchangeRates} from '../infrastructure/exchange-rates.ts'

const now=()=>new Date('2026-10-04T08:00:00Z')
const xml=`<Cube><Cube time='2026-10-02'><Cube currency='USD' rate='1.1225'/><Cube currency='GBP' rate='0.85033'/></Cube></Cube>`
test('ECB cross-currency arithmetic is dated; invalid, stale and future rates cannot be silently used',()=>{
  const rates=parseEcbRates(xml,now());assert.equal(rates.usdPerUnit.EUR,1.1225);assert.equal(rates.usdPerUnit.USD,1);assert.equal(rates.usdPerUnit.GBP,1.1225/0.85033)
  for(const invalid of [xml.replace('2026-10-02','2026-09-01'),xml.replace('2026-10-02','2026-10-05'),xml.replace('1.1225','0'),'<html>Login</html>'])assert.throws(()=>parseEcbRates(invalid,now()),/exchange_rates_/)
})
test('one feed request serves multiple scans; resume freezes provenance and a new day refreshes once',async()=>{
  const root=await mkdtemp(join(tmpdir(),'external-fx-'));let calls=0
  try{
    const cachePath=join(root,'daily.json'),fetchImpl:typeof fetch=async(_url,init)=>{calls++;assert.equal(init?.redirect,'error');return new Response(xml)}
    const first=await resolveScanExchangeRates({runDirectory:join(root,'a'),cachePath},{now,fetchImpl})
    const second=await resolveScanExchangeRates({runDirectory:join(root,'b'),cachePath},{now,fetchImpl})
    assert.equal(calls,1);assert.equal(second.mode,'daily_cache');assert.deepEqual(first.rates,second.rates)
    const tomorrow=()=>new Date('2026-10-05T08:00:00Z')
    const resumed=await resolveScanExchangeRates({runDirectory:join(root,'a'),cachePath,resume:true},{now:tomorrow,fetchImpl})
    assert.equal(calls,1);assert.deepEqual(first.rates,resumed.rates)
    await resolveScanExchangeRates({runDirectory:join(root,'c'),cachePath},{now:tomorrow,fetchImpl});assert.equal(calls,2)
    await resolveScanExchangeRates({runDirectory:join(root,'old'),cachePath,resume:true},{now,fetchImpl});assert.equal(calls,2)
  }finally{await rm(root,{recursive:true,force:true})}
})
test('unavailable feed stays explicit without retry storms; abort is not swallowed as a website error',async()=>{
  const root=await mkdtemp(join(tmpdir(),'external-fx-'));let calls=0
  try{
    const cachePath=join(root,'daily.json'),fetchImpl:typeof fetch=async()=>{calls++;throw Error('secret upstream diagnostic')}
    const first=await resolveScanExchangeRates({runDirectory:join(root,'a'),cachePath},{now,fetchImpl})
    const second=await resolveScanExchangeRates({runDirectory:join(root,'b'),cachePath},{now,fetchImpl})
    assert.equal(calls,1);assert.equal(first.rates,undefined);assert.equal(second.rates,undefined);assert.equal(first.reason,'exchange_rates_transport_unavailable')
    const abort=new AbortController();abort.abort(Error('quota_stopped'))
    await assert.rejects(resolveScanExchangeRates({runDirectory:join(root,'c'),cachePath:join(root,'other')},{now,fetchImpl,signal:abort.signal}),/quota_stopped/)
  }finally{await rm(root,{recursive:true,force:true})}
})
