import {test} from 'node:test';import assert from 'node:assert/strict';
import {createNewTaskProxy} from './new-proxy-service.mts';import {proxyFingerprint} from './new-proxy.mts';
import type {ManagedProfile} from '../../octo-access/contracts.mts';
test('new-proxy flow reads back existing attempts, blocks old/substituted connections, and retains a skipped old-IP result',async()=>{
 const old={type:'socks5' as const,host:'gate.example.test',port:1080,login:'old',password:'fixture'};
 const next={...old,login:'new'};let actual={...old,uuid:'old',title:'old',profiles_count:1};
 let queues=0,v:any={baselineUuid:'old'};
 const p={id:1,clientId:7,locale:'en',uuid:'profile',phase:'ready',revision:1,original:{title:'fixture'},proxy:{uuid:'old'}} as ManagedProfile;
 const t={id:1,clientId:7,linkedinAccountId:11,outlookAccountId:12,status:'не начата',version:1,createdAt:'',updatedAt:''} as const;
 const flow=createNewTaskProxy({store:{read:async()=>v,queue:async(_t,_p,input,proof)=>{queues++;v={...v,...proof,operationId:'op'};return{queued:true}}},
  api:{readProfileProxy:async()=>({saved:actual})},check:async input=>{if(input.login==='old')throw Error('offline');return'1.1.1.1'}});
 assert.equal(await flow.ready(t,p),false);await assert.rejects(flow.assert(t,p),{code:'linkedin_task_new_proxy_required'});
 await assert.rejects(flow.queue(t,p,old),{code:'linkedin_task_proxy_reused'});
 await flow.queue(t,p,next);assert.equal(queues,1);assert.equal(v.comparison,'skipped');assert.equal(v.fingerprint,proxyFingerprint(next));
 p.proxyChange={id:'op',phase:'creating',title:'fixture'};
 await flow.queue(t,p,next);assert.equal(queues,1,'re-reading a queued operation never creates a second proxy');
 p.proxy={uuid:'new',title:'new'};p.proxyChange.phase='complete';actual={...next,uuid:'new',title:'new',profiles_count:1};
 assert.equal(await flow.ready(t,p),true);await flow.assert(t,p);
 actual={...actual,login:'substituted'};await assert.rejects(flow.assert(t,p),{code:'linkedin_task_proxy_changed'});
});
test('first EN profile without a proxy can queue its first checked connection; network errors are not treated as absence',async()=>{
 let queued=0,code='octo_proxy_required';
 const flow=createNewTaskProxy({store:{read:async()=>({baselineUuid:undefined,baselineFingerprint:undefined,baselineIp:undefined,baselineConnection:undefined,fingerprint:undefined,exitIp:undefined,operationId:undefined,comparison:undefined}),queue:async()=>{queued++;return{queued:true}}},
  api:{readProfileProxy:async()=>{throw Object.assign(Error(),{code})}},check:async()=>'1.1.1.1'});
 const p={id:1,clientId:7,locale:'en',uuid:'profile',phase:'ready',revision:1,original:{title:'fixture'}} as ManagedProfile;
 const t={id:1,clientId:7,linkedinAccountId:11,outlookAccountId:12,status:'не начата',version:1,createdAt:'',updatedAt:''} as const;
 await flow.queue(t,p,{type:'socks5',host:'gate.example.test',port:1080,login:'new',password:'fixture'});assert.equal(queued,1);
 code='network';await assert.rejects(flow.queue(t,p,{type:'socks5',host:'gate.example.test',port:1080,login:'new',password:'fixture'}),{code:'network'});assert.equal(queued,1);
});
