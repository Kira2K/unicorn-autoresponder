import {test} from 'node:test';
import assert from 'node:assert/strict';
import {run,memoryLock,updateInput} from './runtime.mts';
import {memoryStore} from './memory-store.mts';
import {emptyState} from './types.mts';
import {mentorTelegram} from './telegram-adapter.mts';
import {createMentorService} from './service.mts';
import {harness} from './test-harness.mts';
test('adapter uses explicit token/requester, handles membership and keeps support credentials out',async()=>{
  process.env.VEU_SUPPORT_BOT='must-not-be-used';process.env.MENTOR_BOT_API_KEY='must-not-be-used';
  try{
    const urls:string[]=[];
    const adapter=mentorTelegram({token:'synthetic',requester:async(url,options)=>{
      urls.push(url);const body=JSON.parse(String(options.body));
      return {ok:true,status:200,json:async()=>({ok:true,result:url.endsWith('getChatMember')?
        {status:'member',user:{id:body.user_id,is_bot:false,first_name:'test'}}:
        {message_id:1,date:1,chat:{id:-100,type:'group'},text:body.text}})};
    }});
    assert.equal(await adapter.member('-100',1),true);
    await adapter.send({chatId:'-100',text:'mock'});
    assert.equal(urls.length,2);assert.ok(urls.every(url=>url.includes('/botsynthetic/')));
    assert.throws(()=>mentorTelegram({token:'',requester:async()=>{throw Error('no');}}));
  }finally{delete process.env.VEU_SUPPORT_BOT;delete process.env.MENTOR_BOT_API_KEY;}
});
test('runtime skips a temporary action failure, preserves the checkpoint and releases the lock',async()=>{
  const store=memoryStore(emptyState()),lock=memoryLock(),stop=new AbortController();
  const offsets:(number|undefined)[]=[];let handled=0;
  await run({store,lock,signal:stop.signal,maintenance:async()=>{},wait:async()=>{},send:harness().sender,
    api:{async getUpdates(offset){offsets.push(offset);if(handled===1){stop.abort();return [];}return [{
      update_id:10,message:{message_id:1,date:1,chat:{id:-100,type:'group'},from:{id:1,username:'alice',is_bot:false,first_name:'A'},text:'/menu'}}];},
      async answerCallbackQuery(){}},
    async handle(){handled++;return {code:handled===1?'unavailable':'ok'};}});
  assert.deepEqual(offsets,[undefined,11]);assert.equal(store.snapshot().offset,11);
  assert.equal(await lock.acquire(),true);await lock.release();
});
test('a second runtime cannot start; no username, bot/anonymous/private updates are rejected',async()=>{
  const lock=memoryLock();await lock.acquire();
  await assert.rejects(run({store:memoryStore(emptyState()),lock,signal:new AbortController().signal,maintenance:async()=>{},send:harness().sender,
    api:{async getUpdates(){throw Error('never');},async answerCallbackQuery(){}},async handle(){return {code:'ok'};}}),/already_running/);
  assert.equal(updateInput({update_id:1,message:{chat:{id:1,type:'private'},from:{id:1,username:'alice'}}}),null);
  assert.equal(updateInput({update_id:1,message:{chat:{id:-1,type:'group'},from:{id:1}}}),null);
  assert.equal(updateInput({update_id:1,message:{chat:{id:-1,type:'group'},from:{id:1,username:'alice'},sender_chat:{id:-1}}}),null);
});
test('membership/SQL outages fail closed without giving staff access or changing data',async()=>{
  const h=harness();
  for(const member of [async()=>false,async()=>{throw Error('network');}]){
    const service=createMentorService({store:h.store,member,reportChatId:'-900',now:h.now});
    assert.notEqual((await service.handle({updateId:1,chatId:'-100',username:'mentor',userId:1,text:'/hard_done'})).code,'ok');
  }
  const broken=createMentorService({store:{async transaction(){throw Error('db');}},member:async()=>true,reportChatId:'-900',now:h.now});
  assert.equal((await broken.handle({updateId:1,chatId:'-100',username:'mentor',userId:1,text:'/hard_done'})).code,'unavailable');
  assert.equal(Object.keys(h.store.snapshot().history).length,0);
});

test('malformed updates and malformed membership responses cannot grant access',async()=>{
  for(const value of [null,{}, {update_id:1,message:{}}, {update_id:1,message:{chat:{},from:{}}}])
    assert.equal(updateInput(value),null);
  for(const result of [null,{}, {status:'member'}, {status:'member',user:{id:999}}]){
    const adapter=mentorTelegram({token:'synthetic',requester:async()=>({ok:true,status:200,json:async()=>({ok:true,result})})});
    await assert.rejects(adapter.member('-100',1),/membership_response_invalid/);
  }
});
