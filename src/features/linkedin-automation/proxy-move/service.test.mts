import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProxyMoveService} from './service.mts';
import {crmProxyPause,destination} from './contracts.mts';
import type {Move,MoveStore} from './contracts.mts';
import type {ManagedProfile} from '../../octo-access/contracts.mts';
function fixture(answer='Yes') {
  let move:Move|undefined,writes=0,checks=0;
  const profile:ManagedProfile={id:1,clientId:901,locale:'en',revision:1,operationId:'setup',password:'12345',uuid:'en-test',
    phase:'ready',ownProxy:false,createdAt:0,original:{title:'Test',description:'',tags:[],start_pages:[]},proxy:{uuid:'old',title:'old',isMadeByExpert:true}};
  const store:MoveStore={async checkSchema(){},async read(){return move;},async readForProfile(){return move;},async queueReplacement(){throw Error('not used');},async begin(m,p,input){writes++;move=m;profile.proxyChange={id:m.id,phase:'queued',title:'new',input};},
    async finish(m,p,at){writes++;return move={...m,phase:'completed',completedAt:at,pauseUntil:new Date(Date.parse(at)+48*3600000).toISOString()};}};
  let country='Spain',dolphin=false;
  const service=createProxyMoveService({store,profiles:{async list(){return [profile];}},allowed:id=>id===901,async hasDolphin(){return dolphin;},
    async account(){return{linkedinAccountId:10,hasLinkedIn:true} as any;},async client(){return{readyForInterviewInEnglishIn2Months:answer};},
    async check(){checks++;return{ok:true,exit_ip:'1.1.1.1',country};},async previousProxy(){return{saved:{uuid:'old',title:'old',profiles_count:1,type:'socks5' as const,host:'old.invalid',port:1080,login:'old',password:'private'}};},now:()=>Date.parse('2026-11-06T10:00:00Z')});
  return{service,profile,setCountry(v:string){country=v;},setDolphin(){dolphin=true;},get writes(){return writes;},get checks(){return checks;},get move(){return move;},
    assigned(){profile.proxyChange={...profile.proxyChange!,phase:'complete',uuid:'new'};profile.proxy={uuid:'new',title:'new'};}};
}
const input={type:'socks5',host:'example.invalid',port:1080,login:'u',password:'p'};
test('survey selects both destinations and rejects missing answers',async()=>{
  assert.equal(destination('Yes'),'ES');assert.equal(destination('No'),'GE');
  const f=fixture('');await assert.rejects(f.service.replace(901,input),/survey_required/);assert.equal(f.checks,0);
  const ge=fixture('No');ge.setCountry('Georgia');assert.equal((await ge.service.replace(901,input)).move?.country,'GE');
});
test('wrong/unknown country leaves the old expert proxy and history untouched',async()=>{
  for(const country of ['Georgia','']){const f=fixture();f.setCountry(country);await assert.rejects(f.service.replace(901,input),/country_mismatch/);
    assert.equal(f.writes,0);assert.equal(f.profile.proxy?.uuid,'old');}
});
test('assignment and completion are idempotent, bound and require closed access',async()=>{
  const f=fixture();await f.service.replace(901,input);await f.service.replace(901,input);assert.equal(f.checks,1);assert.equal(f.writes,1);
  await assert.rejects(f.service.finish(901,{countryChanged:true}),/assignment_pending/);f.assigned();
  f.profile.grant={phase:'granted'} as any;
  await assert.rejects(f.service.finish(901,{countryChanged:true}),/close_profile_first/);delete f.profile.grant;
  await assert.rejects(f.service.finish(901,{}),/confirmation_required/);
  const done=await f.service.finish(901,{countryChanged:true});await f.service.finish(901,{countryChanged:true});assert.equal(f.writes,2);
  assert.equal(done.move?.phase,'completed');assert.equal(crmProxyPause(f.move!,Date.parse(f.move!.pauseUntil!)-1).status,'Пауза');
  assert.equal(crmProxyPause(f.move!,Date.parse(f.move!.pauseUntil!)).status,'Раскачка');
  assert.equal(JSON.stringify(done).includes('private'),false);
});
test('foreign student, Dolphin and open profile cannot replace',async()=>{
  const f=fixture();await assert.rejects(f.service.replace(902,input),/forbidden/);f.setDolphin();await assert.rejects(f.service.replace(901,input),/forbidden/);
  const g=fixture();g.profile.grant={phase:'granted'} as any;await assert.rejects(g.service.replace(901,input),/close_profile_first/);assert.equal(g.checks,0);
});
test('the same connection cannot be presented as a new personal proxy',async()=>{
  const f=fixture();await assert.rejects(f.service.replace(901,{...input,host:'old.invalid',login:'old',password:'private'}),/same_connection/);assert.equal(f.writes,0);
});
