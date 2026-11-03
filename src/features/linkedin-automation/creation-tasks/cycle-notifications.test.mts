import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliverCycleNotification,type CycleNotice} from './cycle-notifications.mts';
import type {SendOneInput,SendOneResult} from '../../../integrations/telegram/types.ts';

const client=async()=>({firstName:'Николай',lastName:'Соколов',fio:'',clientName:'',primaryStack:'JAVA'});
const events:CycleNotice[]=['reports','student'].map(recipient=>({taskId:16,clientId:270,
 recipient:recipient as CycleNotice['recipient'],chatId:recipient==='reports'?'-1003187558078':'-7007',
 url:'https://linkedin.com/in/new',token:recipient}));
const success=(id:number):SendOneResult=>({kind:'telegram-response',response:{ok:true,result:{message_id:id,date:1,
 chat:{id:-7007,type:'supergroup',title:'test'},text:'fixture'}}});

test('completion sends exactly one report without mentions and one formatted student message to frozen destinations',async()=>{
 const pending=structuredClone(events),sent:SendOneInput[]=[],finished:unknown[][]=[];
 const store={claim:async()=>pending.shift(),finish:async(...args:unknown[])=>{finished.push(args);return{rows:[]}}};
 const pass=()=>deliverCycleNotification({store,client,sendOne:async input=>{sent.push(input);return success(sent.length)}});
 await pass();await pass();assert.equal(await pass(),false);
 assert.equal(sent.length,2);assert.deepEqual(sent.map(m=>m.chatId),['-1003187558078','-7007']);
 assert.match(sent[0].text,/🚨 НОВЫЙ LINKEDIN/);assert.match(sent[0].text,/Николай Соколов/);
 assert.match(sent[0].text,/JAVA/);assert.match(sent[0].text,/№16/);assert.match(sent[0].text,/https:\/\/linkedin.com\/in\/new/);
 assert.doesNotMatch(sent[0].text,/@|fyi|password|proxy/i);
 assert.equal(sent[1].parseMode,'HTML');
 assert.equal(sent[1].text,'Привет! Твой LinkedIn готов! 🎉\n\nЛогин и пароль от LinkedIn и доступ к Octo — в личном кабинете, в разделе «LinkedIn».\n\nЧтобы аккаунт не забанили, пожалуйста:\n\n• <b>Первый месяц вообще не заходи в LinkedIn.</b> Аккаунт сейчас прогревает наша команда, и любой лишний вход может привести к бану.\n\n• Через месяц заходи в LinkedIn <b>ТОЛЬКО через Octo на компьютере</b>: не с телефона и не из обычного браузера.\n\n• Не включай двухфакторную аутентификацию и не меняй пароль.');
 assert.deepEqual(finished.map(row=>row[1]),['sent','sent']);
});

for(const outcome of ['failed','uncertain','validation','configuration','transport','response','internal'] as const){
 test(`${outcome}: one delivery failure never blocks the other or retries a claimed event`,async()=>{
  const pending=structuredClone(events),sent:SendOneInput[]=[],finished:unknown[][]=[];
  const store={claim:async()=>pending.shift(),finish:async(...args:unknown[])=>{finished.push(args);return{rows:[]}}};
  const pass=()=>deliverCycleNotification({store,client,sendOne:async input=>{
   sent.push(input);if(input.chatId==='-7007')return success(2);
   if(outcome==='uncertain')throw Error('secret transport details');
   if(outcome==='failed')return{kind:'telegram-response',response:{ok:false,error_code:403,description:'blocked'}};
   return{kind:'client-failure',failure:{stage:outcome,error:{name:'Error',message:'secret transport details'}}};
  }});
  await pass();await pass();await pass();assert.equal(sent.length,2);
  assert.deepEqual(finished.map(row=>row[1]),[['failed','validation','configuration'].includes(outcome)?'failed':'uncertain','sent']);
  assert.ok(!JSON.stringify(finished).includes('secret'));
 });
}

test('a missing destination fails closed, without substituting the reports chat',async()=>{
 let attempted=false,sends=0;const results:unknown[][]=[];
 const store={claim:async()=>{if(attempted)return;attempted=true;return{...events[1],chatId:undefined}},
  finish:async(...args:unknown[])=>{results.push(args);return{rows:[]}}};
 await deliverCycleNotification({store,client,sendOne:async()=>{sends++;return success(1)}});
 assert.equal(sends,0);assert.equal(results[0][1],'failed');assert.equal(results[0][3],'recipient_missing');
});
