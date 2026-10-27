import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateNewProxy,proxyFingerprint} from './new-proxy.mts';
const old={type:'socks5' as const,host:'gate.example.test',port:1080,login:'old',password:'fixture'};
const next={...old,login:'new'};
test('new proxy requires a new connection, not a new UUID or title',async()=>{
 let calls=0;await assert.rejects(validateNewProxy({...old,uuid:'different',changeIpUrl:'https://example.test'},old,{},async()=>{calls++;return'1.1.1.1'}),{code:'linkedin_task_proxy_reused'});assert.equal(calls,0);
 assert.equal(proxyFingerprint({...old,host:'GATE.EXAMPLE.TEST'}),proxyFingerprint(old));
 assert.equal(proxyFingerprint({...old,host:'gate.example.test.'}),proxyFingerprint(old));
 assert.equal(proxyFingerprint({...old,host:'[2001:db8::1]'}),proxyFingerprint({...old,host:'2001:db8:0:0:0:0:0:1'}));
});
test('same gateway allowed, but known equal IP is refused; unknown old IP is successful with explicit skipped comparison',async()=>{
 await assert.rejects(validateNewProxy(next,old,{},async()=> '1.1.1.1'),{code:'linkedin_task_proxy_ip_reused'});
 const different=await validateNewProxy(next,old,{},async p=>p.login==='new'?'1.1.1.1':'2.2.2.2');assert.equal(different.proof.comparison,'different');
 const skipped=await validateNewProxy(next,old,{},async p=>{if(p.login==='old')throw Error('offline');return'1.1.1.1'});assert.equal(skipped.proof.comparison,'skipped');
 await assert.rejects(validateNewProxy(next,old,{},async()=>{throw Error('password=never-return')}),{code:'linkedin_task_proxy_check_failed'});
 await assert.rejects(validateNewProxy(next,undefined,{},async()=> 'invalid'),{code:'linkedin_task_proxy_check_failed'});
 await assert.rejects(validateNewProxy(next,undefined,{baselineIp:'1.1.1.1'},async()=> '1.1.1.1'),{code:'linkedin_task_proxy_ip_reused'});
 await assert.rejects(validateNewProxy(next,undefined,{baselineIp:'2001:db8:0:0:0:0:0:1'},async()=> '2001:db8::1'),{code:'linkedin_task_proxy_ip_reused'});
});
