import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliverMoveNotice} from './notifications.mts';
test('one claim produces one test-chat notice; unknown send cannot be retried',async()=>{
  for(const outcome of ['sent','unknown','rejected']){
    let claimed=false;const sends:any[]=[],finished:any[]=[];
    const store={async claim(){if(claimed)return;claimed=true;return{move:{id:'move',clientId:901,country:'ES',completedAt:'2026-11-06T10:00:00Z'} as any,token:'claim',test:true};},
      async finish(...args:any[]){finished.push(args);return{rows:[]};}};
    const pass=()=>deliverMoveNotice({store,client:async()=>({firstName:'Тест',lastName:'Ученик',primaryStack:'JAVA'}),sendOne:async input=>{
      sends.push(input);if(outcome==='unknown')throw Error('unknown');
      return outcome==='sent'?{kind:'telegram-response',response:{ok:true,result:{message_id:12,date:1,chat:{id:-5216637594,type:'group',title:'test'},text:'test'}}}:
        {kind:'telegram-response',response:{ok:false,error_code:403,description:'rejected'}};
    }});
    await pass();await pass();assert.equal(sends.length,1);assert.equal(sends[0].chatId,'-5216637594');
    assert.equal(finished[0][2],outcome==='sent'?'sent':outcome==='unknown'?'uncertain':'failed');
    assert.match(sends[0].text,/Тест Ученик/);assert.match(sends[0].text,/Испания/);assert.match(sends[0].text,/@juliafeels fyi/);
  }
});
