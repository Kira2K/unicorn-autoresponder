import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SendOneInput, SendOneResult } from '../../../integrations/telegram/types.ts';
import { createTaskStatusReporter } from './status-report.mts';

const sent = { kind:'telegram-response', response:{ ok:true, result:{ message_id:77, date:1,
  chat:{ id:-1003187558078,type:'supergroup',title:'Managers' },text:'sent' } } } satisfies SendOneResult;
const change = { taskId:14,clientId:270,from:'не начата',to:'блок' } as const;
function fixture(result:SendOneResult = sent) {
  const calls:SendOneInput[] = [];
  const report = createTaskStatusReporter({ chatId:'-1003187558078',mention:'@juliafeels',
    client:async id => { assert.equal(id,270); return {firstName:'Nikolai',lastName:'Sokolov',fio:'',clientName:'Synthetic fixture',primaryStack:'JAVA'}; },
    sendOne:async input => { calls.push(input); return result; } });
  return {report,calls};
}
test('status report uses the manager chat, exact task/client data and plain Russian text',async()=>{
  const f=fixture();
  assert.deepEqual(await f.report(change),{outcome:'sent',messageId:77});
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].chatId,'-1003187558078');
  assert.equal(f.calls[0].text,'Заявка на создание LinkedIn №14\nКлиент: Nikolai Sokolov\nСтек: JAVA\nДенис изменил статус: «не начата» → «блок».\n\n@juliafeels fyi');
  assert.equal(f.calls[0].parseMode,undefined);
  assert.equal(f.calls[0].reportContext?.clientId,270);
});
test('missing stack is stated explicitly without losing the status notification',async()=>{
  for(const primaryStack of [undefined,'','   ']) {
    let text='';
    const report=createTaskStatusReporter({chatId:'-1003187558078',mention:'@juliafeels',
      client:async()=>({firstName:'Test',lastName:'Student',fio:'',clientName:'',primaryStack}),
      sendOne:async input=>{text=input.text;return sent;}});
    assert.equal((await report(change)).outcome,'sent');
    assert.match(text,/\nСтек: не указан\n/);
  }
});
test('API rejection is failed, a lost response is uncertain, and neither is retried',async()=>{
  const cases:[SendOneResult,string][] = [
    [{kind:'telegram-response',response:{ok:false,error_code:403,description:'Forbidden'}},'failed'],
    [{kind:'client-failure',failure:{stage:'configuration',error:{name:'Error',message:'missing token'}}},'failed'],
    [{kind:'client-failure',failure:{stage:'transport',error:{name:'Error',message:'timeout'}}},'uncertain'],
    [{kind:'client-failure',failure:{stage:'response',error:{name:'Error',message:'invalid response'}}},'uncertain']
  ];
  for (const [response,outcome] of cases) {
    const f=fixture(response);
    assert.equal((await f.report(change)).outcome,outcome);
    assert.equal(f.calls.length,1);
  }
});
test('name loading failure cannot send an incomplete notification; thrown send remains uncertain',async()=>{
  let sends=0;
  const input={chatId:'-1003187558078',mention:'@juliafeels',client:async()=>{throw Error('private lookup error');},
    sendOne:async()=>{sends++;return sent;}};
  assert.deepEqual(await createTaskStatusReporter(input)(change),{outcome:'failed',code:'client_lookup_failed'});
  assert.equal(sends,0);
  assert.deepEqual(await createTaskStatusReporter({...input,client:async()=>({firstName:'',lastName:'',fio:'Test <name> & surname',clientName:''}),
    sendOne:async()=>{sends++;throw Error('private send error');}})(change),{outcome:'uncertain',code:'notification_internal'});
  assert.equal(sends,1);
});
