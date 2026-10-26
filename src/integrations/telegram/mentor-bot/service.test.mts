import {test} from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './test-harness.mts';
import {fixtureClient} from './test-fixtures.mts';
import {WEEK} from './calendar.mts';
const reports=(h:ReturnType<typeof harness>)=>h.sent.filter(x=>x.chatId==='-900');
test('hard, readiness and mentor changes require confirmation; first not ready has no report',async()=>{
  const h=harness();
  await h.command('/hard_done','mentor');
  assert.equal(h.store.snapshot().learners['1'].hardCompletedAt,undefined);
  await h.click('confirm','mentor');
  const hardAt=h.store.snapshot().learners['1'].hardCompletedAt;
  assert.equal(hardAt,h.now());assert.equal(reports(h).length,1);
  assert.equal(h.store.snapshot().clients['1'].status,'studying');
  await h.command('/hard_done','mentor');await h.click('confirm','mentor');
  assert.equal(reports(h).length,1);assert.equal(h.store.snapshot().learners['1'].hardCompletedAt,hardAt);
  await h.command('/ready_pitch');await h.click('no');await h.click('confirm');
  assert.equal(reports(h).length,1);
  await h.click('edit');await h.click('yes');await h.click('confirm');
  assert.equal(reports(h).length,2);
  const buttons=(h.sent.at(-1)!.replyMarkup as {inline_keyboard:{text:string}[][]}).inline_keyboard.flat().map(b=>b.text);
  assert.deepEqual(buttons,['✏️ Изменить ответ','🏠 Главное меню']);
  await h.click('edit');await h.click('no');
  assert.equal(h.store.snapshot().learners['1'].ready,true);assert.equal(reports(h).length,2);
  await h.click('confirm');
  assert.equal(h.store.snapshot().learners['1'].ready,false);assert.equal(reports(h).length,3);
  await h.command('/ready_pitch');assert.equal(h.session().step,'select');
  await h.click('yes');await h.click('confirm');
  assert.equal(h.store.snapshot().learners['1'].ready,true);assert.equal(reports(h).length,4);
  assert.match(reports(h).at(-1)!.text,/повторно/);
  await h.command('/change_mentor','mentor');await h.click('soft-type','mentor');
  await h.command('not a username','mentor');assert.equal(h.session('mentor').step,'mentor-input');
  await h.command('@NEWMENTOR','mentor');assert.equal(h.store.snapshot().clients['1'].softMentor,'@softmentor');
  await h.click('confirm','mentor');assert.equal(h.store.snapshot().clients['1'].softMentor,'@newmentor');
});
test('market transitions change both market and stage; existing automation owns the preparation message',async()=>{
  const h=harness([fixtureClient({market:'ru'})]);
  await h.command('/market_both','mentor');assert.equal(h.store.snapshot().clients['1'].status,'studying');
  await h.click('confirm','mentor');
  assert.equal(h.store.snapshot().clients['1'].status,'hh_both process');
  assert.equal(h.store.snapshot().clients['1'].market,'both');
  const prepared=h.store.snapshot().learners['1'];
  assert.equal(prepared.active,true);assert.equal(prepared.activatedAt,h.now());
  assert.equal(h.sent.filter(m=>m.text.includes('поздравляем с переходом')).length,0);
  await h.command('/responses_started','mentor');await h.click('confirm','mentor');
  assert.equal(h.store.snapshot().clients['1'].status,'on en market');
  assert.equal(h.store.snapshot().learners['1'].active,true);
  assert.equal(h.store.snapshot().learners['1'].activatedAt,prepared.activatedAt);
  assert.equal(h.store.snapshot().learners['1'].nextOpenAt,prepared.nextOpenAt);
  assert.equal(Object.keys(h.store.snapshot().checkins).length,0);
});

for(const current of [null,'ru','en','both'] as const){
  for(const selected of ['ru','en','both'] as const){
    test(`market ${current} plus ${selected} preserves both directions when they differ`,async()=>{
      const h=harness([fixtureClient({market:current})]);
      await h.command('/market_'+selected,'mentor');
      assert.equal(h.store.snapshot().clients['1'].market,current);
      await h.click('confirm','mentor');
      const expected=current===null||current===selected?selected:'both';
      assert.equal(h.store.snapshot().clients['1'].market,expected);
      assert.equal(h.store.snapshot().clients['1'].status,{ru:'hh_ru process',en:'hh_en process',both:'hh_both process'}[selected]);
      const audit=Object.values(h.store.snapshot().history)[0];
      assert.deepEqual(audit.before,{status:'studying',market:current});
      assert.equal((audit.after as {market:string}).market,expected);
    });
  }
}

test('manual response confirmations also merge an existing opposite market without enabling automation',async()=>{
  for(const [market,status] of [['ru','hh_en process'],['en','hh_ru process']] as const){
    const h=harness([fixtureClient({market,status})]);
    await h.command('/responses_started','mentor');
    assert.equal(h.store.snapshot().clients['1'].market,market);
    await h.click('confirm','mentor');
    assert.equal(h.store.snapshot().clients['1'].market,'both');
  }
});
test('checkin atomically saves only after two confirmations; both roles can start a correction',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);h.setNow(Date.parse('2026-10-22T14:00:00Z'));
  await h.command('/menu');await h.click('checkin');await h.click('no');await h.click('confirm');
  assert.equal(h.session().step,'q2');assert.equal(Object.values(h.store.snapshot().checkins)[0].result,undefined);
  assert.equal(reports(h).length,0);
  await h.click('no');await h.click('confirm');
  let ch=Object.values(h.store.snapshot().checkins)[0];
  assert.equal(ch.result?.recruiters,false);assert.equal(ch.result?.interviews,false);
  assert.equal(reports(h).length,1);assert.match(reports(h)[0].text,/⚠️/);
  assert.equal((await h.click('edit')).code,'ok');assert.equal(h.session().step,'q1');
  await h.command('/menu','mentor');await h.click('checkin','mentor');await h.click('edit','mentor');
  await h.click('yes','mentor');await h.click('confirm','mentor');await h.click('no','mentor');
  assert.equal(Object.values(h.store.snapshot().checkins)[0].result?.recruiters,false);
  await h.click('confirm','mentor');
  ch=Object.values(h.store.snapshot().checkins)[0];
  assert.equal(ch.result?.recruiters,true);assert.equal(reports(h).length,2);
  assert.match(reports(h)[1].text,/Отчёт об обновлении/);
  assert.equal(Object.keys(h.store.snapshot().history).length,2);
});
test('membership, foreign callback, duplicate event and stale confirmations cannot change business data',async()=>{
  const h=harness();
  assert.equal((await h.command('/hard_done')).code,'denied');
  await h.command('/hard_done','mentor');const s=h.session('mentor');
  assert.equal((await h.service.handle({username:'otherstaff',userId:3,chatId:'-100',updateId:800,
    messageId:s.messageId,callback:'m:'+s.id+':'+s.revision+':confirm'})).code,'denied');
  const event={username:'mentor',userId:2,chatId:'-100',updateId:801,messageId:s.messageId,callback:'m:'+s.id+':'+s.revision+':confirm'};
  assert.equal((await h.service.handle(event)).code,'ok');
  assert.equal((await h.service.handle(event)).code,'duplicate');
  assert.equal(Object.keys(h.store.snapshot().history).length,1);
  await h.flush();
  await h.command('/change_mentor','mentor');await h.click('soft-type','mentor');await h.command('@newmentor','mentor');
  await h.store.transaction(s=>{s.clients['1'].softMentor='@someone';});
  assert.equal((await h.click('confirm','mentor')).code,'stale');
  assert.equal(h.store.snapshot().clients['1'].softMentor,'@someone');
});
test('different drafts cannot combine; only one initial result wins and old periods reject',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);h.setNow(Date.parse('2026-10-22T14:00:00Z'));
  for(const actor of ['alice','mentor']){await h.command('/menu',actor);await h.click('checkin',actor);await h.click('yes',actor);await h.click('confirm',actor);}
  await h.click('no');await h.click('confirm');
  await h.click('yes','mentor'); // reload winner instead of overwriting
  assert.equal(h.session('mentor').step,'result');
  assert.equal(reports(h).length,1);
  const old=h.session();h.setNow(h.now()+WEEK);
  const out=await h.service.handle({username:'alice',userId:1,chatId:'-100',updateId:900,messageId:old.messageId,
    callback:'m:'+old.id+':'+old.revision+':confirm'});
  assert.notEqual(out.code,'ok');assert.equal(reports(h).length,1);
});
test('cancel, home and start discard drafts; back requires first confirmation again',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);h.setNow(Date.parse('2026-10-22T14:00:00Z'));
  await h.command('/menu');await h.click('checkin');await h.click('yes');await h.click('confirm');await h.click('back');
  assert.equal(h.session().firstConfirmed,undefined);assert.equal(h.session().step,'q1');
  const beforeStart=h.store.snapshot(),draft=h.session();
  assert.equal((await h.command('/start')).code,'ok');
  const afterStart=h.store.snapshot();
  for(const key of ['clients','learners','checkins','history'] as const)assert.deepEqual(afterStart[key],beforeStart[key]);
  assert.equal(afterStart.sessions[draft.id],undefined);
  await h.click('checkin');assert.equal(h.session().recruiters,undefined);
  assert.equal(Object.values(h.store.snapshot().checkins)[0].result,undefined);
});


test('menu and checkin keyboards match the two-role, two-confirmation contract',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);h.setNow(Date.parse('2026-10-22T14:00:00Z'));
  const labels=()=>{const s=h.session();return (h.sent.filter(m=>m.editMessageId===s.messageId||!m.editMessageId).at(-1)?.replyMarkup as {inline_keyboard:{text:string}[][]}).inline_keyboard.flat().map(b=>b.text);};
  await h.command('/menu');
  assert.deepEqual(labels(),['📍 Мой этап','🎤 Готовность к самопрезентации','📋 Еженедельный чекин','🏠 Главное меню']);
  const menuLabels=labels();
  assert.equal((await h.command('/start@mentor_test_bot')).code,'ok');assert.deepEqual(labels(),menuLabels);
  await h.click('checkin');
  assert.deepEqual(labels(),['Да','Нет','Назад','🏠 Главное меню']);
  await h.click('yes');
  assert.deepEqual(labels(),['✏️ Изменить ответы','✅ Подтвердить выбор','🏠 Главное меню']);
  await h.click('confirm');assert.equal(h.session().step,'q2');
  await h.click('no');await h.click('confirm');
  assert.deepEqual(labels(),['✏️ Изменить ответ','🏠 Главное меню']);
  assert.match(h.sent.at(-1)!.text,/результат чекина сохранён/);
});

test('a missing or invalid student username blocks all changes while stage information remains readable',async()=>{
  for(const tag of ['', 'not a username']){
    const h=harness([fixtureClient({username:tag})]);
    assert.equal((await h.command('/what_my_stage','mentor')).code,'ok');
    for(const command of ['/hard_done','/ready_pitch','/market_en','/change_mentor','/responses_started'])
      assert.equal((await h.command(command,'mentor')).code,'denied');
    assert.deepEqual(h.store.snapshot().history,{});
    assert.equal(h.store.snapshot().clients['1'].market,'ru');
  }
});

test('readiness is allowed before hard completion and a student can correct a complete no/no checkin until the next one',async()=>{
  const h=harness([fixtureClient({status:'on ru market'})]);
  await h.command('/ready_pitch');await h.click('yes');await h.click('confirm');
  assert.equal(h.store.snapshot().learners['1'].hardCompletedAt,undefined);
  assert.equal(h.store.snapshot().learners['1'].ready,true);
  h.setNow(Date.parse('2026-11-05T14:00:00Z'));
  await h.command('/menu');await h.click('checkin');
  assert.equal(h.store.snapshot().learners['1'].recruiterMisses,2);
  await h.click('no');await h.click('confirm');await h.click('no');await h.click('confirm');
  assert.equal(h.store.snapshot().learners['1'].recruiterMisses,0);
  assert.equal(h.store.snapshot().learners['1'].interviewMisses,0);
  await h.click('edit');await h.click('yes');await h.click('confirm');await h.click('yes');await h.click('confirm');
  const ch=Object.values(h.store.snapshot().checkins).find(c=>c.state==='open')!;
  assert.equal(ch.result?.actor,'alice');assert.equal(ch.result?.recruiters,true);assert.equal(ch.result?.interviews,true);
  const old=h.session();h.setNow(ch.closesAt);
  assert.notEqual((await h.service.handle({username:'alice',userId:1,chatId:'-100',updateId:990,
    messageId:old.messageId,callback:'m:'+old.id+':'+old.revision+':edit'})).code,'ok');
  assert.deepEqual(h.store.snapshot().checkins[ch.id].result,ch.result);
});
