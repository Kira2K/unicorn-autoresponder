import {test} from 'node:test';import assert from 'node:assert/strict';
import {deliverExistingNotification} from './existing-notifications.mts';
test('existing LinkedIn sends one configured mention without credentials and does not retry an unknown send',async()=>{
 for(const outcome of ['sent','uncertain']){
  let claimed=false;const messages:any[]=[],finished:any[]=[];
  const store={claim:async()=>{if(claimed)return;claimed=true;return{accountId:11,clientId:7,url:'https://linkedin.com/in/test',token:'test'};},finish:async(...args:any[])=>{finished.push(args);return{rows:[]};}};
  const pass=()=>deliverExistingNotification({store,mention:'@KiraSamsonova',client:async()=>({firstName:'Test',lastName:'Student',fio:'',clientName:'',primaryStack:'JAVA'}),
   sendOne:async input=>{messages.push(input);if(outcome==='uncertain')throw Error('unknown');return{kind:'telegram-response',response:{ok:true,result:{message_id:77,date:1,chat:{id:-1003187558078,type:'supergroup',title:'test'},text:'test'}}};}});
  await pass();await pass();assert.equal(messages.length,1);assert.equal(finished[0][1],outcome);
  assert.match(messages[0].text,/@KiraSamsonova fyi$/);assert.doesNotMatch(messages[0].text,/@juliafeels|password|proxy/i);
 }
});
