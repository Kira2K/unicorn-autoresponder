import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProxyConnectivityCheck} from './proxy-connectivity.mts';
const input={type:'socks5' as const,host:'proxy.example.com',port:1080,login:'test-user',password:'private-password'};
test('connectivity requires one successful HTTPS response and IP, without score or geography',async()=>{
 let probes=0;
 const check=createProxyConnectivityCheck({lookup:async()=>[{address:'1.1.1.1',family:4}],probe:async options=>{
  probes++;assert.deepEqual(options.input,input);assert.equal(options.address,'1.1.1.1');return{status:200,body:'{"ip":"203.0.113.25"}'};
 }});
 assert.deepEqual(await check(input),{ok:true,exit_ip:'203.0.113.25'});assert.equal(probes,1);
});
test('connectivity rejects private/mixed DNS addresses before opening a proxy connection',async()=>{
 for(const address of ['127.0.0.1','10.0.0.1','172.18.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1']){
  const check=createProxyConnectivityCheck({lookup:async()=>[{address:'1.1.1.1',family:4},{address,family:address.includes(':')?6:4}],probe:async()=>{assert.fail('private proxy must not be contacted');}});
  await assert.rejects(check(input),{code:'octo_proxy_check_failed'});
 }
});
test('HTTP failures, invalid IP bodies and transport exceptions expose no credentials',async()=>{
 for(const probe of [async()=>({status:407,body:'private-password'}),async()=>({status:200,body:'{}'}),async()=>({status:200,body:'{"ip":"not-an-ip"}'}),async()=>{throw Error('private-password')}]){
  const check=createProxyConnectivityCheck({lookup:async()=>[{address:'1.1.1.1',family:4}],probe});
  await assert.rejects(check(input),error=>(error as any).code==='octo_proxy_check_failed'&&!String(error).includes('private-password'));
 }
});
test('one deadline covers DNS and the HTTP request without retries',async()=>{
 let probes=0,signal:AbortSignal|undefined;
 const check=createProxyConnectivityCheck({timeoutMs:20,lookup:async()=>[{address:'1.1.1.1',family:4}],probe:async options=>{probes++;signal=options.signal;return new Promise(()=>{});}});
 await assert.rejects(check(input),{code:'octo_proxy_check_failed'});assert.equal(probes,1);assert.equal(signal?.aborted,true);
});
