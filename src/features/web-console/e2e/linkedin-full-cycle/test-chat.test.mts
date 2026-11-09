import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTelegramBotApi} from '../../../../integrations/telegram/bot-api.ts';
import {verifyTestChat} from './test-chat.mts';
import {E2E_STUDENT_CHAT_ID} from './contracts.mts';
function fixture(status='member',permissions:any={can_send_messages:true},extra:any={}){
 const calls:Array<{method:string;body:any}>=[];
 const api=createTelegramBotApi({env:{VEU_SUPPORT_BOT:'fixture-only'},requester:async(url,options)=>{
  const method=url.split('/').at(-1)!;calls.push({method,body:JSON.parse(String(options.body))});
  const result=method==='getMe'?{id:7,is_bot:true}:method==='getChat'?{id:Number(E2E_STUDENT_CHAT_ID),type:'supergroup',permissions}:method==='getChatMember'?{user:{id:7},status,...extra}:undefined;
  assert.ok(result,'preflight must never send a message');return{ok:true,status:200,json:async()=>({ok:true,result})};
 }});return{api,calls};
}
test('checks configured bot and canonical group without sending',async()=>{
 const f=fixture();const proof=await verifyTestChat({},f.api);assert.equal(proof.chatId,E2E_STUDENT_CHAT_ID);assert.equal(proof.canSendMessages,true);
 assert.deepEqual(f.calls,[{method:'getMe',body:{}},{method:'getChat',body:{chat_id:E2E_STUDENT_CHAT_ID}},{method:'getChatMember',body:{chat_id:E2E_STUDENT_CHAT_ID,user_id:7}}]);
});
for(const status of ['left','kicked','member','restricted'])test(`blocks ${status} without sending rights`,async()=>{
 const f=fixture(status,{can_send_messages:false});await assert.rejects(verifyTestChat({},f.api),/e2e_test_chat_not_writable/);assert.equal(f.calls.length,3);
});
test('administrator can send despite default member restrictions',async()=>{assert.equal((await verifyTestChat({},fixture('administrator',{can_send_messages:false}).api)).canSendMessages,true);});
test('restricted member needs membership and explicit permission',async()=>{assert.equal((await verifyTestChat({},fixture('restricted',{}, {is_member:true,can_send_messages:true}).api)).canSendMessages,true);});
test('unknown read outcome fails closed without leaking or retrying',async()=>{
 let calls=0;const api={async getMeResponse(){calls++;throw Error('provider credential-bearing URL');},async getChatResponse(){throw Error('unexpected');},async getChatMemberResponse(){throw Error('unexpected');}};
 await assert.rejects(verifyTestChat({},api),{message:'e2e_test_chat_read_failed'});assert.equal(calls,1);
});
test('a different destination is rejected before membership lookup',async()=>{
 const api={async getMeResponse(){return{ok:true,result:{id:7,is_bot:true}};},async getChatResponse(){return{ok:true,result:{id:-123,type:'supergroup'}};},async getChatMemberResponse(){throw Error('unexpected');}};
 await assert.rejects(verifyTestChat({},api),/e2e_test_chat_identity_invalid/);
});
