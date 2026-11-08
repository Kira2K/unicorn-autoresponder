import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProxyMoveService} from './service.mts';
import {guardStudentProxy} from './student-proxy.mts';
import type {Move,MoveStore} from './contracts.mts';
import type {ManagedProfile} from '../../octo-access/contracts.mts';
const input={type:'socks5',host:'replacement.example.invalid',port:1080,login:'private',password:'private'};
function fixture(){
 let country='Spain',works=true,accountId=10,answer='No',failCheck=false,afterCheck=()=>{};
 let writes=0,checks=0;
 const profile:ManagedProfile={id:1,clientId:901,locale:'en',revision:1,operationId:'initial',password:'private',uuid:'en-test',phase:'ready',ownProxy:true,createdAt:0,original:{title:'Test',description:'',tags:[],start_pages:[]},proxy:{uuid:'old',title:'old'},proxyChange:{id:'first-move',phase:'complete',uuid:'old',title:'old'}};
 let move:Move={id:'first-move',clientId:901,accountId:10,profileId:1,profileUuid:'en-test',country:'ES',fingerprint:'initial',phase:'completed',createdAt:'2026-11-01T00:00:00Z',completedAt:'2026-11-02T00:00:00Z',pauseUntil:'2026-11-04T00:00:00Z'};
 const store:MoveStore={async checkSchema(){},async read(id,account){return account===move.accountId?structuredClone(move):undefined;},async readForProfile(id,pid){return id===901&&pid===1?structuredClone(move):undefined;},async begin(){throw Error('unexpected_initial_move');},async finish(){throw Error('unexpected_finish');},async queueReplacement(m,p,raw,proof,operationId,fingerprint){
  assert.equal(p.revision,profile.revision);writes++;profile.revision++;profile.proxyChange={id:operationId,phase:'queued',title:'replacement',input:raw};move={...move,lastProxyCheck:{...proof,operationId,fingerprint}};
 }};
 const service=createProxyMoveService({store,profiles:{async list(){return[structuredClone(profile)];}},allowed:id=>id===901,async hasDolphin(){return false;},async account(){return{linkedinAccountId:accountId,hasLinkedIn:true} as any;},async client(){return{readyForInterviewInEnglishIn2Months:answer};},async check(){checks++;if(failCheck)throw Error('private');const r={ok:works,exit_ip:'203.0.113.25',country};afterCheck();return r;},async previousProxy(){throw Error('unexpected_old_proxy_read');}});
 return{service,profile,get move(){return move;},get checks(){return checks;},get writes(){return writes;},setCountry(v:string){country=v;},setWorks(v:boolean){works=v;},failCheck(){failCheck=true;},afterCheck(fn:()=>void){afterCheck=fn;},changeAccount(){accountId=20;},assigned(){profile.proxy={uuid:'new-'+writes,title:'new'};profile.proxyChange={...profile.proxyChange!,phase:'complete',uuid:profile.proxy.uuid};}};
}
test('unlimited replacements use completed move country and preserve completion/event identity',async()=>{
 const f=fixture(),original=structuredClone(f.move);
 for(let i=0;i<3;i++){await f.service.replace(901,{...input,host:`replace-${i}.example.invalid`});assert.equal(f.writes,i+1);f.assigned();}
 assert.equal(f.checks,3);for(const key of ['id','fingerprint','completedAt','pauseUntil','country'] as const)assert.equal(f.move[key],original[key]);
 const view=await f.service.status(901);assert.equal(view.move?.phase,'completed');assert.equal(view.proxyCheck?.exitIp,'203.0.113.25');assert.equal(JSON.stringify(view).includes('private'),false);
});
test('wrong/unknown country, dead proxy and timeout leave completed move and old proxy intact',async()=>{
 for(const failure of ['wrong','unknown','dead','timeout']){const f=fixture();if(failure==='wrong')f.setCountry('Georgia');if(failure==='unknown')f.setCountry('');if(failure==='dead')f.setWorks(false);if(failure==='timeout')f.failCheck();
  await assert.rejects(f.service.replace(901,input));assert.equal(f.writes,0);assert.equal(f.profile.proxy?.uuid,'old');assert.equal(f.move.lastProxyCheck,undefined);
 }
});
test('revision, account binding and access are rechecked after network I/O',async()=>{
 for(const mutation of ['revision','account','grant']){const f=fixture();f.afterCheck(()=>{if(mutation==='revision')f.profile.revision++;if(mutation==='account')f.changeAccount();if(mutation==='grant')f.profile.grant={phase:'granted'} as any;});
  await assert.rejects(f.service.replace(901,input));assert.equal(f.writes,0);
 }
});
test('standard student save cannot bypass country check; expert and unrelated paths retain their contract',async()=>{
 const f=fixture();let ordinary=0;const base={async saveProxy(){ordinary++;return{profiles:[]};},async status(){return{profiles:[]};}} as any;
 const guarded=guardStudentProxy(base,f.service);f.setCountry('Georgia');await assert.rejects(guarded.saveProxy(901,1,input));assert.equal(ordinary,0);assert.equal(f.writes,0);
 await guarded.saveProxy(901,2,input);await guarded.saveProxy(901,1,input,true);assert.equal(ordinary,2);
 f.changeAccount();await assert.rejects(guarded.saveProxy(901,1,input));assert.equal(ordinary,2,'old-account move must not fall through');
});
