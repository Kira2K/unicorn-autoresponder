import {test} from 'node:test';import assert from 'node:assert/strict';
import {deliverCycleNotification} from './cycle-notifications.mts';
test('one claimed committed event sends a loud name/stack/task notice, with no retry on unknown sends',async()=>{
 for(const outcome of ['sent','failed','uncertain']){
  const sent:any[]=[],finished:any[]=[];let claimed=false;
  const store={claim:async()=>{if(claimed)return;claimed=true;return{taskId:16,clientId:270,url:'https://linkedin.com/in/new',token:'fixture'};},finish:async(...args:any[])=>{finished.push(args);return{rows:[]}}};
  const pass=()=>deliverCycleNotification({store,client:async()=>({firstName:'Nikolai',lastName:'Sokolov',fio:'',clientName:'',primaryStack:'JAVA'}),sendOne:async input=>{
   sent.push(input);if(outcome==='uncertain')throw Error('lost response');
   return outcome==='sent'?{kind:'telegram-response',response:{ok:true,result:{message_id:4,date:1,chat:{id:-1003187558078,type:'supergroup',title:'test'},text:'fixture'}}}
    :{kind:'telegram-response',response:{ok:false,error_code:403,description:'rejected'}};
  }});
  await pass();await pass();assert.equal(sent.length,1);assert.equal(finished[0][1],outcome);
  assert.equal(sent[0].chatId,'-1003187558078');assert.match(sent[0].text,/🚨 НОВЫЙ LINKEDIN/);assert.match(sent[0].text,/Nikolai Sokolov/);assert.match(sent[0].text,/JAVA/);assert.match(sent[0].text,/@juliafeels fyi/);
 }
});

test('cycle notification accepts a recipient override without mentioning the default recipient',async()=>{
 const sent:any[]=[],finished:any[]=[];
 const store={claim:async()=>({taskId:16,clientId:270,url:'https://linkedin.com/in/new',token:'fixture'}),
  finish:async(...args:any[])=>{finished.push(args);return{rows:[]};}};
 await deliverCycleNotification({store,mention:'@KiraSamsonova',
  client:async()=>({firstName:'Test',lastName:'Student',fio:'',clientName:'',primaryStack:'JAVA'}),
  sendOne:async input=>{sent.push(input);return{kind:'telegram-response',response:{ok:true,
   result:{message_id:4,date:1,chat:{id:-1003187558078,type:'supergroup',title:'test'},text:'fixture'}}};}});
 assert.equal(sent.length,1);
 assert.match(sent[0].text,/@KiraSamsonova fyi$/);
 assert.doesNotMatch(sent[0].text,/@juliafeels/);
 assert.equal(finished[0][1],'sent');
});
