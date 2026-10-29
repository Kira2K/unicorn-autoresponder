import {test} from 'node:test';import assert from 'node:assert/strict';
import {checkManualProxy,manualProxyFingerprint,manualProxyUrl} from './manual-proxy-check.mts';
const input={type:'https' as const,host:'proxy.example.com',port:8080,login:'a@b',password:'private'};
test('manual check preserves protocol and requires IP, without requiring country or score',async()=>{
 assert.equal(manualProxyUrl(input),'https://a%40b:private@proxy.example.com:8080');
 const result=await checkManualProxy(input,async()=>({ok:true,index:0,proxy:'fixture',exit_ip:'1.1.1.1',country:'Georgia',final_score:1}),()=>42);
 assert.deepEqual(result,{fingerprint:manualProxyFingerprint(input),exitIp:'1.1.1.1',country:'Georgia',checkedAt:42});
 assert.deepEqual(await checkManualProxy(input,async()=>({ok:true,exit_ip:'1.1.1.1'}),()=>42),{fingerprint:manualProxyFingerprint(input),exitIp:'1.1.1.1',checkedAt:42});
 for(const patch of [{ok:false},{exit_ip:null},{exit_ip:'invalid'}])
  await assert.rejects(checkManualProxy(input,async()=>({ok:true,index:0,proxy:'fixture',exit_ip:'1.1.1.1',country:'Georgia',...patch})),{code:'octo_proxy_check_failed'});
});
