import { memoryProgress } from "./memory-progress.test-helper.mts";
/** Independent TAS-143 oracle. Diagnostics only: no business code changes or live sends. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { planReminder, planStatusMessage, type Client, type AccountKind } from './policy.ts';
import { messageText, testMessageConfig } from "./message-config.test-helper.mts";
import { runLifecyclePass, type LifecycleStore } from './pass.mts';
import { deliverPlan, type Delivery, type Store } from './worker.ts';
import { createClientSender } from './sender.mts';
import { createTelegramIntegration } from '../../integrations/telegram/integration.ts';

const kinds: AccountKind[] = ['phone_en','phone_ru','hh_en','hh_ru','linkedin','telegram_en','telegram_ru','email_en','email_ru'];
const names: Record<AccountKind,string> = {phone_en:'Иностранный номер телефона',phone_ru:'Российский номер телефона',
  hh_en:'Профиль hh.ru (иностранный)',hh_ru:'Профиль hh.ru (российский)',linkedin:'Аккаунт LinkedIn',
  telegram_en:'Telegram для иностранного рынка',telegram_ru:'Telegram для российского рынка',email_en:'Почта для иностранного рынка',email_ru:'Почта для российского рынка'};
const now = new Date('2026-10-14T16:00:00.000Z');
const activatedAt = new Date('2026-09-01T00:00:00Z');
const oldStatusAt = new Date('2026-09-02T00:00:00Z');
const state = {now,activatedAt,statusChangedAt:oldStatusAt,lastSentAt:null,statusChangeId:'1'};
function client(patch: Partial<Client> = {}): Client {
  return {id:1,name:'Synthetic student',status:'studying',role:'ученик',market:'ru',tag:'@audit_student',chatId:'-1001111111111',
    hardMentor:'@audit_mentor',googleFolder:'https://example.invalid/drive',missingPersonal:[],missingStopList:false,
    indicators:Object.fromEntries(kinds.map(k=>[k,'заполнен'])) as Client['indicators'],...patch};
}
const coverage = {status_role_market:0,account_masks:0,personal_masks:0,clock_cases:0,wire_requests:0};
after(()=>console.log(JSON.stringify({audit_coverage:coverage,real_telegram_requests:0})));
const templates:string[] = JSON.parse(readFileSync(new URL('./tas-143-messages.json',import.meta.url),'utf8'));

test('TAS-143: all five message templates match the original byte-for-byte after placeholder replacement',()=>{
  assert.equal(templates.length,5);
  for(const [stage,role,index] of [['onboarding','ученик',0],['onboarding','клиент',1],['hh_ru process','ученик',2],['hh_both process','клиент',2],['hh_en process','клиент',3]] as const){
    const c=client({stage:undefined,status:stage,role} as Partial<Client>);
    const plan=planStatusMessage(c,{id:'1',oldStatus:'previous',newStatus:stage,at:now},activatedAt);
    assert.equal(plan.kind,'send');if(plan.kind!=='send')continue;
    const golden=templates[index].replaceAll('@{тег}','@audit_student').replaceAll('@{тег_хард_ментора}','@audit_mentor').replaceAll('{google_folder}',c.googleFolder);
    assert.equal(messageText(c,plan),golden,`${stage}/${role}`);
  }
  const c=client({missingPersonal:['Имя','Образование'],missingStopList:true});
  const plan=planReminder(c,state);assert.equal(plan.kind,'send');if(plan.kind!=='send')return;
  assert.equal(messageText(c,plan),templates[4].replaceAll('@{тег}','@audit_student').replace('{список незаполненных пунктов}','— Имя\n— Образование\n— Стоп-лист компаний'));
});

test('TAS-143 5: complete status × role × market matrix, current real transitions only',()=>{
  const statuses=['onboarding','studying','hh_ru process','hh_both process','on ru market','hh_en process','on en market','paused','graduated','blacklisted','left','unknown','test','','unexpected'];
  const roles=['ученик','клиент','реферал','фейк','','unexpected'];
  const markets=['ru','en','both',null] as const;
  for(const status of statuses)for(const role of roles)for(const market of markets){
    const c=client({status,role,market});const p=planStatusMessage(c,{id:'1',oldStatus:'previous',newStatus:status,at:now},activatedAt);
    const eligible=['onboarding','hh_ru process','hh_both process','hh_en process'].includes(status);
    const expected=!eligible?'skip':role===''?'error':['ученик','клиент'].includes(role)?'send':'skip';
    assert.equal(p.kind,expected,`${status}/${role}/${market}`);
    if(p.kind==='send'){assert.equal(p.chatId,c.chatId);assert.equal(p.tag,c.tag)}
    coverage.status_role_market++;
  }
});

test('TAS-143 6.2: every valid status/market row × all 512 account combinations',()=>{
  const rows: Array<[string,Client['market'],AccountKind[]]>=[];
  const ru:AccountKind[]=['phone_ru','email_ru','telegram_ru'];
  const en:AccountKind[]=['phone_en','phone_ru','linkedin','telegram_en','telegram_ru','email_en','email_ru'];
  for(const status of ['onboarding','studying','hh_ru process','on ru market'])rows.push([status,'ru',[...ru,...(['onboarding','studying'].includes(status)?[]:['hh_ru' as const])]]);
  for(const market of ['en','both'] as const)for(const status of ['onboarding','studying','hh_ru process','hh_both process','on ru market','hh_en process','on en market'])
    rows.push([status,market,[...en,...(['onboarding','studying'].includes(status)?[]:['hh_ru' as const]),...(['hh_en process','on en market'].includes(status)?['hh_en' as const]:[])]]);
  for(const [status,market,required] of rows)for(let mask=0;mask<512;mask++){
    const indicators=Object.fromEntries(kinds.map((k,i)=>[k,mask&(1<<i)?'не заполнен':'заполнен'])) as Client['indicators'];
    const expected=required.filter(k=>indicators[k]==='не заполнен').map(k=>names[k]);
    const p=planReminder(client({status,market,indicators}),state);coverage.account_masks++;
    assert.equal(p.kind,expected.length?'send':'skip',`${status}/${market}/${mask}`);
    if(p.kind==='send')assert.deepEqual(p.missing,expected,`${status}/${market}/${mask}`);
  }
});

test('TAS-143 6.3–6.6: all 2048 personal-field subsets preserve order and do not include age/patronymic',()=>{
  const fields=['Имя','Фамилия','ФИО полностью','Дата рождения','Уровень английского','Готовность к собеседованию на английском','Реальная локация','Желаемая локация','Личный email','Личный Telegram','Образование'];
  for(let mask=0;mask<2048;mask++){
    const missingPersonal=fields.filter((_,i)=>mask&(1<<i));const c=client({missingPersonal,missingStopList:true});
    c.indicators.email_ru='не заполнен';const p=planReminder(c,state);coverage.personal_masks++;
    assert.equal(p.kind,'send');if(p.kind!=='send')continue;
    assert.deepEqual(p.missing,[...missingPersonal,'Стоп-лист компаний','Почта для российского рынка']);
    assert.doesNotMatch(messageText(c,p),/Возраст|Отчество/);
  }
});

test('TAS-143 6.1: every second of a Moscow day, including exact 19:00 and 20:00 boundaries',()=>{
  const c=client({missingStopList:true});
  for(let seconds=0;seconds<86400;seconds++){
    const n=new Date(Date.UTC(2026,9,14)+seconds*1000);
    const p=planReminder(c,{...state,now:n});coverage.clock_cases++;
    assert.equal(p.kind,seconds>=16*3600&&seconds<17*3600?'send':'skip',n.toISOString());
  }
});

test('TAS-143 6.1: 48h and 7-day thresholds are not rounded to calendar days',()=>{
  for(const delta of [-1,0,1]){
    const p=planReminder(client({missingStopList:true}),{...state,lastSentAt:new Date(now.getTime()-48*3600000+delta)});
    assert.equal(p.kind,delta>0?'skip':'send');
    const q=planReminder(client({status:'onboarding',missingStopList:true}),{...state,statusChangedAt:new Date(now.getTime()-7*86400000+delta)});
    assert.equal(q.kind,delta>0?'skip':'send');
  }
});

test('TAS-143 6.1: activation alone must not add an extra 48-hour delay for overdue students',()=>{
  const p=planReminder(client({missingStopList:true}),{...state,activatedAt:new Date(now.getTime()-3600000)});
  assert.equal(p.kind,'send','Only last sent reminder/HH transition/onboarding age are specified clocks');
});

function fixture(changes: Awaited<ReturnType<LifecycleStore['changes']>>, c=client({status:'hh_en process'})){
  const claimed=new Set<string>();const deliveries:Delivery[]=[];let sends=0,cursor='0';
  const progress=memoryProgress();
  const store:LifecycleStore={...progress,activation:async()=>({activatedAt,statusCursor:cursor}),clients:async()=>[{client:c,statusChangeId:changes.at(-1)?.id??null,statusChangedAt:oldStatusAt,lastSentAt:null,lastHHTransitionAt:null}],
    changes:async(_cursor,at=now)=>progress.select(changes,at),advanceCursor:async next=>{cursor=next},
    delivery:{claim:async key=>{if(claimed.has(key))return false;claimed.add(key);return true},finish:async(key,value)=>{deliveries.push(value);if(value.outcome==="failed")claimed.delete(key)}}};
  return {store,send:async()=>{sends++;return {outcome:'sent' as const,messageId:sends}},sends:()=>sends,deliveries};
}
const passOptions={now,apply:true,statuses:true,reminders:false,messageConfig: testMessageConfig, supportChatId:'-1009999999999'};
test('TAS-143 5: each committed HH transition is delivered even if two transitions happen between polls',async()=>{
  const f=fixture([{id:'1',clientId:1,oldStatus:'studying',newStatus:'hh_ru process',at:now},{id:'2',clientId:1,oldStatus:'hh_ru process',newStatus:'hh_en process',at:now}]);
  await runLifecyclePass({...passOptions,...f});
  assert.equal(f.sends(),2,'Both real transitions require one notification according to section 5');
});
test('delivery: an explicit rejection then restored access must not lose the transition forever',async()=>{
  const c=client({status:'hh_ru process'});const f=fixture([{id:'1',clientId:1,oldStatus:'studying',newStatus:c.status,at:now}],c);
  const p=planStatusMessage(c,{id:'1',oldStatus:'studying',newStatus:c.status,at:now},activatedAt);let attempts=0;
  const send=async():Promise<Delivery>=>++attempts===1?{outcome:'failed',code:'telegram_429'}:{outcome:'sent',messageId:1};
  const input={client:c,plan:p,now,enabled:true,store:f.store.delivery,messageConfig: testMessageConfig, supportChatId:passOptions.supportChatId,send};
  await deliverPlan(input);await deliverPlan({...input,now:new Date(now.getTime()+100000)});
  assert.ok(f.deliveries.some(d=>d.outcome==='sent'),'Known non-delivery must be recoverable, unlike an unknown response');
});

async function wireCase(reply:unknown, failure=false,text='literal audit message'){
  const require=createRequire(import.meta.url);
  const path=fileURLToPath(new URL('../../integrations/telegram/index.ts',import.meta.url));
  const previous=require.cache[path];const requests:Array<{chat_id:string,text?:string}>=[];
  const logs:unknown[]=[];
  const telegram=createTelegramIntegration({env:{VEU_SUPPORT_BOT:'synthetic-test-token',summary_logs_channel_id:'-1009999999999'},regularErrorChatId:'-1009999999999',summaryLogsChatId:'-1009999999999',logger:e=>logs.push(e),
    requester:async(_url,options)=>{
      coverage.wire_requests++;const body=JSON.parse(String(options.body));requests.push(body);
      if(requests.length===1&&failure)throw Error('synthetic socket reset');
      const result=requests.length===1?reply:{ok:true,result:{message_id:10,date:1,chat:{id:Number(body.chat_id),type:'supergroup'},text:body.text}};
      return {ok:true,status:200,json:async()=>result};
    }});
  const mock=new Module(path);mock.filename=path;mock.loaded=true;mock.exports={telegramForReports:(route:string)=>{assert.equal(route,'-1009999999999');return telegram}};require.cache[path]=mock;
  try {return {delivery:await createClientSender('-1009999999999')('-1001111111111',text),requests,logs}}
  finally {if(previous)require.cache[path]=previous;else delete require.cache[path]}
}
test('actual sender + actual Telegram facade: success preserves target/body and does not issue a second send',async()=>{
  const f=await wireCase({ok:true,result:{message_id:42,date:1,chat:{id:-1001111111111,type:'supergroup'},text:'literal audit message'}});
  assert.deepEqual(f.delivery,{outcome:'sent',messageId:42});assert.equal(f.requests.length,1);assert.equal(f.requests[0].chat_id,'-1001111111111');assert.equal(f.requests[0].text,'literal audit message');
  assert.doesNotMatch(JSON.stringify(f.logs),/synthetic-test-token|literal audit message/);
});
test('all five product texts reach the actual HTTP payload literally, with no Markdown/HTML alteration',async()=>{
  for(const text of templates.map(t=>t.replaceAll('@{тег}','@audit_student').replaceAll('@{тег_хард_ментора}','@audit_mentor').replaceAll('{google_folder}','https://example.invalid/drive').replaceAll('{список незаполненных пунктов}','— Имя'))){
    const f=await wireCase({ok:true,result:{message_id:42,date:1,chat:{id:-1001111111111,type:'supergroup'},text}},false,text);
    assert.equal(f.delivery.outcome,'sent');assert.equal(f.requests.length,1);assert.equal(f.requests[0].text,text);
    assert.equal((f.requests[0] as Record<string,unknown>).parse_mode,undefined);
  }
});
test('actual sender: all explicit API errors are classified, without retrying the original message',async()=>{
  for(const code of [400,401,403,429,500,502,503]){
    const f=await wireCase({ok:false,error_code:code,description:'synthetic API rejection',parameters:{retry_after:12}});
    assert.deepEqual(f.delivery,{outcome:'failed',code:`telegram_${code}`,retryAfterSeconds:12});
    assert.equal(f.requests.filter(r=>r.chat_id==='-1001111111111').length,1);
  }
});
test('actual sender: timeout/invalid response stays uncertain and is never resent to the student',async()=>{
  for(const [reply,failure] of [[{},true],[{},false],[null,false],['invalid body',false]] as const){
    const f=await wireCase(reply,failure);assert.equal(f.delivery.outcome,'uncertain');
    assert.equal(f.requests.filter(r=>r.chat_id==='-1001111111111').length,1);
  }
});
test('actual sender: error reports use only the configured support route, never an unrelated hardcoded chat',async()=>{
  const f=await wireCase({ok:false,error_code:429,description:'synthetic rejection'});
  assert.deepEqual(f.requests.slice(1).map(r=>r.chat_id),['-1009999999999']);
});
