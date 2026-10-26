import {test} from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './test-harness.mts';
import {fixtureClient} from './test-fixtures.mts';
import {deliver} from './delivery.mts';
import {mentorTelegram} from './telegram-adapter.mts';
import {createMentorService} from './service.mts';

const group=(h:ReturnType<typeof harness>)=>h.sent.filter(m=>m.chatId==='-100');
let update=1000;
async function shared(h:ReturnType<typeof harness>,action:string,actor='alice',messageId=h.session(actor).messageId){
  const result=await h.service.handle({updateId:++update,username:actor,userId:actor==='alice'?1:2,
    chatId:'-100',messageId,callback:'mentor:'+action});await h.flush();return result;
}

test('menu, stage, readiness, confirmation, correction and home transform the same message without new group posts',async()=>{
  const h=harness();await h.command('/menu');const messageId=h.session().messageId;
  await shared(h,'stage');assert.equal(h.session().messageId,messageId);
  await shared(h,'home');await shared(h,'ready');
  for(const control of ['yes','confirm','edit','no','confirm','edit','back']){
    await h.click(control);assert.equal(h.session().messageId,messageId);
  }
  await shared(h,'home');
  assert.equal(h.session().messageId,messageId);
  assert.equal(group(h).filter(m=>m.editMessageId===undefined).length,1);
  assert.ok(group(h).slice(1).every(m=>m.editMessageId===messageId));
  assert.ok(group(h).some(m=>m.text.includes('готов к мок-интервью')));
  const buttons=group(h).at(-1)!.replyMarkup as {inline_keyboard:{text:string}[][]};
  assert.deepEqual(buttons.inline_keyboard.flat().map(b=>b.text),[
    '📍 Мой этап','🎤 Готовность к самопрезентации','📋 Еженедельный чекин','🏠 Главное меню']);
});

test('cancel and saved hard instructions stay in the same staff message; reports keep their separate destination',async()=>{
  const h=harness();await h.command('/hard_done','mentor');const messageId=h.session('mentor').messageId;
  await h.click('cancel','mentor');assert.match(group(h).at(-1)!.text,/Выбор отменён/);
  assert.equal(h.session('mentor').messageId,messageId);
  await h.command('/hard_done','mentor');const freshId=h.session('mentor').messageId;await h.click('confirm','mentor');
  assert.notEqual(freshId,messageId);assert.equal(h.session('mentor').messageId,freshId);
  assert.equal(group(h).filter(m=>m.editMessageId===undefined).length,2);
  assert.match(group(h).at(-1)!.text,/с хардами/);
  assert.equal(h.sent.filter(m=>m.chatId==='-900').length,1);
  assert.equal(Object.keys(h.store.snapshot().history).length,1);
});

test('the complete checkin, result and correction use one message and keep both-answer confirmations',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);h.setNow(Date.parse('2026-10-22T14:00:00Z'));
  await h.command('/menu');const messageId=h.session().messageId,initialPosts=group(h).filter(m=>m.editMessageId===undefined).length;
  await shared(h,'checkin');
  for(const control of ['no','confirm','yes','confirm']){
    await h.click(control);assert.equal(h.session().messageId,messageId);
    if(h.session().step!=='result')assert.equal(Object.values(h.store.snapshot().checkins)[0].result,undefined);
  }
  await h.click('edit');await h.click('yes');await h.click('confirm');await h.click('no');await h.click('confirm');
  await shared(h,'home');
  assert.equal(h.session().messageId,messageId);
  assert.equal(group(h).filter(m=>m.editMessageId===undefined).length,initialPosts);
  assert.equal(h.sent.filter(m=>m.chatId==='-900').length,2);
});

test('another actor launch reuses their own message and preserves the source draft and confirmation',async()=>{
  const h=harness();await h.command('/menu');const student=h.session();
  await h.command('/hard_done','mentor');const staff=h.session('mentor');
  await shared(h,'ready','alice',staff.messageId);
  assert.equal(h.session().messageId,student.messageId);
  assert.deepEqual(h.session('mentor'),staff);
  assert.equal(group(h).filter(m=>m.editMessageId===undefined).length,2);
  await h.click('yes');await h.click('confirm');
  assert.equal(h.session().messageId,student.messageId);assert.deepEqual(h.session('mentor'),staff);
});

test('temporary edit failures retry the same edit without resending the message or repeating saved data',async()=>{
  const h=harness();await h.command('/ready_pitch');const messageId=h.session().messageId;
  await h.click('yes');const s=h.session();
  const input={updateId:++update,username:'alice',userId:1,chatId:'-100',messageId,
    callback:`m:${s.id}:${s.revision}:confirm`};
  await h.service.handle(input);
  const attempts:number[]=[];
  await deliver({store:h.store,now:h.now,send:async m=>{
    if(m.chatId==='-100'){attempts.push(m.editMessageId!);return {kind:'client-failure',failure:{stage:'transport',error:{name:'Error',message:'test'}}};}
    return h.sender(m);
  }});
  assert.deepEqual(attempts,[messageId]);assert.equal((await h.service.handle(input)).code,'duplicate');
  h.setNow(h.now()+60_000);await h.flush();
  assert.equal(h.session().messageId,messageId);assert.equal(Object.keys(h.store.snapshot().history).length,1);
  assert.equal(group(h).filter(m=>m.editMessageId===undefined).length,1);
});

for(const [status,command] of [['onboarding','/menu'],['studying','/market_both'],['hh_en process','/responses_started']] as const){
  test(`${command}: the saved transition and notice update the existing screen once`,async()=>{
    const h=harness([fixtureClient({status})]);await h.command(command,'mentor');
    if(status==='onboarding')await h.click('onboarding','mentor');
    const messageId=h.session('mentor').messageId,posts=group(h).filter(m=>m.editMessageId===undefined).length;
    await h.click('confirm','mentor');
    assert.equal(h.session('mentor').messageId,messageId);
    assert.equal(group(h).filter(m=>m.editMessageId===undefined).length,posts);
    assert.ok(group(h).at(-1)!.text.includes(status==='onboarding'?'онбординг завершён':status==='studying'?'этап изменён':'начали откликать'));
    assert.equal(Object.keys(h.store.snapshot().history).length,1);
  });
}

test('the actual Telegram adapter sends once and uses editMessageText with the same ID through navigation and confirmation',async()=>{
  const h=harness(),requests:{method:string;body:Record<string,unknown>}[]=[];let nextMessage=500;
  const telegram=mentorTelegram({token:'synthetic',requester:async(url,options)=>{
    const method=url.split('/').at(-1)!,body=JSON.parse(String(options.body));requests.push({method,body});
    const result=method==='getChatMember'?{status:'member',user:{id:body.user_id,is_bot:false,first_name:'Test'}}:
      {message_id:body.message_id??++nextMessage,date:1,chat:{id:Number(body.chat_id),type:'group',title:'Test'},text:body.text};
    return {ok:true,status:200,json:async()=>({ok:true,result})};
  }});
  const service=createMentorService({store:h.store,now:h.now,member:telegram.member,reportChatId:'-900'});
  const flush=()=>deliver({store:h.store,now:h.now,send:telegram.send});
  const actor={username:'alice',userId:1,chatId:'-100'};
  await service.handle({...actor,updateId:++update,text:'/menu'});await flush();const messageId=h.session().messageId;
  await service.handle({...actor,updateId:++update,messageId,callback:'mentor:ready'});await flush();
  for(const control of ['no','confirm']){
    const s=h.session();await service.handle({...actor,updateId:++update,messageId,callback:`m:${s.id}:${s.revision}:${control}`});await flush();
  }
  await service.handle({...actor,updateId:++update,messageId,callback:'mentor:home'});await flush();
  assert.equal(requests.filter(r=>r.method==='sendMessage').length,1);
  const edits=requests.filter(r=>r.method==='editMessageText');assert.equal(edits.length,4);
  assert.ok(edits.every(r=>r.body.message_id===messageId&&r.body.chat_id==='-100'));
  assert.equal(requests.some(r=>r.method==='deleteMessage'),false);assert.equal(h.session().messageId,messageId);
});

test('a second click on an older owned menu shows its error in the same screen without creating another post',async()=>{
  const h=harness();await h.command('/menu');const old=h.session();await shared(h,'ready');
  const input={updateId:++update,username:'alice',userId:1,chatId:'-100',messageId:old.messageId,
    callback:`m:${old.id}:${old.revision}:ready`};
  assert.notEqual((await h.service.handle(input)).code,'ok');await h.flush();
  assert.equal(h.session().messageId,old.messageId);
  assert.equal(group(h).filter(m=>m.editMessageId===undefined).length,1);
  assert.deepEqual(h.store.snapshot().history,{});
});
