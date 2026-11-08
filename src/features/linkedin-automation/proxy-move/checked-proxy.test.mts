import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkMoveProxy,publicCountryFailure} from './checked-proxy.mts';
const input={type:'socks5' as const,host:'proxy.example.invalid',port:1080,login:'private-login',password:'private-password'};
test('existing checker result accepts ES/GE aliases and a valid exit IP',async()=>{
 for(const [expected,country] of [['ES','Spain'],['GE','Georgia'],['ES','españa']] as const){let calls=0;
  const proof=await checkMoveProxy(input,expected,async p=>{assert.deepEqual(p,input);calls++;return{ok:true,exit_ip:'203.0.113.25',country};},()=>0);
  assert.equal(calls,1);assert.deepEqual(proof,{exitIp:'203.0.113.25',country:expected,checkedAt:'1970-01-01T00:00:00.000Z'});
 }
});
test('failed connectivity, invalid IP and checker timeout fail without exposing credentials',async()=>{
 for(const result of [{ok:false,exit_ip:'203.0.113.25',country:'Spain'},{ok:true,exit_ip:'invalid',country:'Spain'},null]){
  await assert.rejects(checkMoveProxy(input,'ES',async()=>{if(!result)throw Error('private-password');return result;}),e=>{
   assert.equal((e as any).code,'linkedin_proxy_move_check_failed');assert.ok(!JSON.stringify(e).includes('private-password'));return true;
  });
 }
});
test('wrong/unknown country gives only safe exit IP, actual and expected countries',async()=>{
 for(const country of ['Georgia','Poland','', 'private-password@proxy.example.invalid']){
  await assert.rejects(checkMoveProxy(input,'ES',async()=>({ok:true,exit_ip:'203.0.113.25',country})),e=>{
   assert.equal((e as any).code,'linkedin_proxy_move_country_mismatch');const details=publicCountryFailure(e);
   assert.equal(details?.exitIp,'203.0.113.25');assert.equal(details?.expectedCountry,'ES');assert.equal(details?.actualCountry,country==='Georgia'?'GE':country==='Poland'?'Poland':undefined);
   assert.ok(!JSON.stringify(e).includes('private-password'));return true;
  });
 }
 assert.equal(publicCountryFailure({code:'unrelated',details:{expectedCountry:'ES',password:'private'}}),undefined);
 assert.deepEqual(publicCountryFailure({code:'linkedin_proxy_move_country_mismatch',details:{expectedCountry:'ES',exitIp:'private-password@host',password:'private'}}),{expectedCountry:'ES'});
});
