const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSendReport}=require('./send-report.ts');
test('preserves destination/text/HTML and accepts only confirmed Bot API success',async()=>{
  let received;
  const send=createSendReport({sendOne:async input=>{received=input;return {kind:'telegram-response',response:{ok:true,result:{message_id:4}}};}});
  await send('-100123','<b>Report</b>',{parseMode:'html'});
  assert.deepEqual(received,{chatId:'-100123',text:'<b>Report</b>',parseMode:'HTML'});
});
test('API rejection and uncertain transport failure propagate without resending',async()=>{
  for(const result of [{kind:'telegram-response',response:{ok:false,error_code:403,description:'Forbidden'}},{kind:'client-failure',failure:{stage:'transport',error:{name:'Timeout',message:'unknown outcome'}}}]){
    let calls=0;const send=createSendReport({sendOne:async()=>{calls++;return result}});
    await assert.rejects(send('-100123','Report'),/Telegram report delivery failed/);
    assert.equal(calls,1);
  }
});
