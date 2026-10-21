import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const { createTelegramIntegration } = createRequire(import.meta.url)('./integration.ts') as typeof import('./integration.ts');
const rejected = { ok: false as const, error_code: 400, description: 'Bad Request: chat not found' };
const ok = { ok: true as const, result: {message_id: 1, date: 1, chat: {id: -900, type: 'supergroup' as const}, text: 'ok'} };
function fixture(reply: unknown = rejected, rejectReport = false) {
  const requests: Record<string, unknown>[] = [], logs: unknown[] = [];
  const telegram = createTelegramIntegration({token: 'test-secret', regularErrorChatId: '-900', summaryLogsChatId: '-900', logger: e=>logs.push(e),
    requester: async (_url, options) => {
      requests.push(JSON.parse(String(options.body)));
      return {ok:true,status:200,json:async()=>requests.length===1?reply:rejectReport?rejected:ok};
    }});
  return {telegram, requests, logs};
}
test('error report identifies original destination, student and purpose without an extra student send', async()=>{
  const f=fixture();
  const result=await f.telegram.sendOne({chatId:'-100123',text:'PRIVATE MESSAGE',
    reportContext:{clientId:3,clientName:'Вениамин Хлебников',chatPurpose:'Общий чат ученика'}});
  assert.deepEqual(result,{kind:'telegram-response',response:rejected});
  assert.equal(f.requests.length,2);
  assert.equal(f.requests[0].chat_id,'-100123');
  assert.equal(f.requests[1].chat_id,'-900');
  const report=String(f.requests[1].text);
  for(const text of ['Чат (ID): -100123','ID ученика в Clients: 3','Ученик: Вениамин Хлебников','Назначение чата: Общий чат ученика','Тип Telegram: неизвестен','chat not found'])assert.ok(report.includes(text),text);
  assert.ok(!report.includes('PRIVATE MESSAGE'));
  assert.ok(!('reportContext' in f.requests[0]));
});
test('success payload is unchanged and creates no report', async()=>{
  const f=fixture(ok);
  await f.telegram.sendOne({chatId:'-100123',text:'unchanged',reportContext:{clientId:3,clientName:'Student',chatPurpose:'Общий чат ученика',chatType:'supergroup'}});
  assert.deepEqual(f.requests,[{chat_id:'-100123',text:'unchanged',disable_web_page_preview:true}]);
});
test('known type is used, metadata is bounded, token-redacted and never logged', async()=>{
  const f=fixture();
  await f.telegram.sendOne({chatId:'-100123',text:'PRIVATE MESSAGE',reportContext:{clientId:3,clientName:'PRIVATE NAME test-secret\n'.repeat(100),chatPurpose:'Общий чат ученика',chatType:'supergroup'}});
  const report=String(f.requests[1].text);
  assert.ok(report.includes('Тип Telegram: supergroup'));
  assert.ok(!report.includes('test-secret'));
  assert.ok(report.length<1200);
  assert.ok(!JSON.stringify(f.logs).includes('PRIVATE NAME'));
  assert.ok(!JSON.stringify(f.logs).includes('PRIVATE MESSAGE'));
});
test('missing metadata still reports destination and does not guess supergroup versus channel from -100', async()=>{
  const f=fixture();
  await f.telegram.sendOne({chatId:'-100123',text:'private'});
  const report=String(f.requests[1].text);
  assert.ok(report.includes('Чат (ID): -100123'));
  assert.ok(report.includes('Тип Telegram: неизвестен'));
});
test('failed report cannot recurse or change original rejection', async()=>{
  const f=fixture(rejected,true);
  const result=await f.telegram.sendOne({chatId:'-100123',text:'private',reportContext:{clientId:3,clientName:'Student',chatPurpose:'Общий чат ученика'}});
  assert.equal(f.requests.length,2);
  assert.deepEqual(result,{kind:'telegram-response',response:rejected});
});
