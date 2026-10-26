import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {readTestConfig} from './test-config.mts';
import {readTestClient} from './test-client.mts';
import {openFileStore} from './file-store.mts';
import {scopeTestTransport, verifyTestTelegram} from './test-transport.mts';
import {emptyState} from './types.mts';
import {fixtureClient, START} from './test-fixtures.mts';
import {enroll} from './schedule.mts';
import {createMentorWorker} from './worker.mts';
import {memoryLock} from './runtime.mts';

const env={MENTOR_BOT_API_KEY:'test-mentor-token',VEU_SUPPORT_BOT:'other-token',
  MENTOR_BOT_USERNAME:'veumentorbot',MENTOR_BOT_REPORT_CHAT_ID:'-900',
  MENTOR_BOT_TEST_CLIENT_ID:'226',MENTOR_BOT_TEST_CHAT_USERNAME:'mentorbotqa',
  MENTOR_BOT_TEST_STUDENT_USERNAME:'veu_support',MENTOR_BOT_TEST_ADMIN_USERNAME:'kuldevit',
  MENTOR_BOT_TEST_HARD_MENTOR_USERNAME:'hhggrraa',MENTOR_BOT_TEST_SOFT_MENTOR_USERNAME:'larakween'};
const config=readTestConfig(env);

test('shared Bot API identity reads use the supplied mentor transport and preserve native results',async()=>{
  const require=createRequire(import.meta.url);
  const {createTelegramBotApi}=require('../bot-api.ts') as typeof import('../bot-api.ts');
  const calls:{method:string;body:unknown}[]=[];
  const result={id:42,username:'veumentorbot',extra:'preserved'};
  const api=createTelegramBotApi({token:'mentor-sentinel',requester:async(url,options)=>{
    assert.ok(url.includes('/botmentor-sentinel/'));
    calls.push({method:url.split('/').at(-1)!,body:JSON.parse(String(options.body))});
    return {ok:true,status:200,json:async()=>({ok:true,result})};
  }});
  assert.deepEqual(await api.getMe(),result);assert.deepEqual(await api.getChat('@mentorbotqa'),result);
  assert.deepEqual(calls,[{method:'getMe',body:{}},{method:'getChat',body:{chat_id:'@mentorbotqa'}}]);
});

test('test configuration requires a separate mentor token and distinct student/staff usernames',()=>{
  assert.equal(readTestConfig({...env,MENTOR_BOT_TEST_STUDENT_USERNAME:'@VEU_SUPPORT'}).studentUsername,'veu_support');
  assert.throws(()=>readTestConfig({...env,MENTOR_BOT_API_KEY:''}),/mentor_test_token_required/);
  assert.throws(()=>readTestConfig({...env,MENTOR_BOT_API_KEY:env.VEU_SUPPORT_BOT}),/mentor_test_separate_token_required/);
  assert.throws(()=>readTestConfig({...env,MENTOR_BOT_TEST_ADMIN_USERNAME:'veu_support'}),/mentor_test_role_conflict/);
  assert.throws(()=>readTestConfig({...env,MENTOR_BOT_TEST_CHAT_ID:'123'}),/mentor_test_group_id_invalid/);
});

test('client snapshot reads one client, tolerates absent mentor columns and applies test-only bindings',async()=>{
  const queries:string[]=[];
  const client=await readTestClient({async query(sql,values){
    queries.push(sql);assert.deepEqual(values,['226']);
    return {rows:[{id:'226',client_name:'TEST',client_status:'test',market_id:1,stack_name:'TypeScript'}]};
  }},config,'-100');
  assert.equal(client.username,'@veu_support');assert.equal(client.chatId,'-100');
  assert.equal(client.softMentor,'@larakween');assert.equal(client.hardMentor,'@hhggrraa');
  assert.equal(queries.length,1);assert.match(queries[0],/^SELECT/);assert.doesNotMatch(queries[0],/UPDATE|INSERT|DELETE/);
});

test('Telegram preflight checks bot identity, group and administrator membership without polling or sending',async()=>{
  const calls:string[]=[];
  const api={async getMe(){calls.push('me');return {id:42,is_bot:true,username:'veumentorbot'};},
    async getChat(chat:string){calls.push(chat);return {id:Number(chat==='@mentorbotqa'?'-100':chat),type:'supergroup'};},
    async getChatMember(chat:string,id:number){calls.push('member:'+chat);return {status:'administrator',user:{id}};}};
  assert.equal(await verifyTestTelegram(api,config),'-100');
  assert.deepEqual(calls,['me','@mentorbotqa','member:-100','-900','member:-900']);
  assert.equal(await verifyTestTelegram(api,{...config,chatId:'-100'}),'-100');
  await assert.rejects(verifyTestTelegram(api,{...config,chatId:'-200'}),/mentor_test_group_mismatch/);
  await assert.rejects(verifyTestTelegram({...api,async getMe(){return {id:42,is_bot:true,username:'wrongbot'};}},config),/mentor_test_bot_mismatch/);
  await assert.rejects(verifyTestTelegram({...api,async getChatMember(){return {status:'member',user:{id:42}};}},config),/mentor_test_bot_admin_required/);
  await assert.rejects(verifyTestTelegram({...api,async getChat(chat){
    if(chat==='-900')throw Error('unavailable');return {id:-100,type:'supergroup'};
  }},config),/mentor_test_report_chat_unavailable/);
});

function update(id:number,chatId=-100,actor='veu_support'){
  return {update_id:id,message:{message_id:id,date:1,chat:{id:chatId,type:'supergroup'},
    from:{id:77,is_bot:false,username:actor},text:'/start@veumentorbot'}};
}
test('test transport consumes unrelated updates without handling them and refuses all other destinations',async()=>{
  const sent:string[]=[];
  const scoped=scopeTestTransport({api:{async getUpdates(){return [update(1),update(2,-200),update(3,-100,'stranger')];},
    async answerCallbackQuery(){}},async member(){return true;},async send(input){sent.push(input.chatId);
      return {kind:'client-failure',failure:{stage:'transport',error:{name:'test',message:'test'}}};}},config,'-100');
  const updates=await scoped.api.getUpdates();
  assert.deepEqual(updates.slice(1),[{update_id:2},{update_id:3}]);
  assert.equal(await scoped.member('-200',77),false);
  const denied=await scoped.send({chatId:'-200',text:'never send'});
  assert.equal(denied.kind,'client-failure');assert.deepEqual(sent,[]);
  await scoped.send({chatId:'-100',text:'test'});await scoped.send({chatId:'-900',text:'report'});
  assert.deepEqual(sent,['-100','-900']);
});

test('file store preserves receipts and client edits after restart, rejects other bindings and serializes writers',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mentor-file-store-'));
  try{
    const file=join(dir,'state.json'),initial=emptyState([fixtureClient()]);
    const store=await openFileStore(file,'binding',initial);
    await assert.rejects(openFileStore(file,'binding',initial),/mentor_test_state_locked/);
    await store.transaction(s=>{s.clients['1'].status='hh_ru process';s.operations['update:1']={at:1};s.offset=2;});
    await assert.rejects(store.transaction(s=>{s.clients['1'].status='wrong';throw Error('abort');}),/abort/);
    await store.close();
    await assert.rejects(openFileStore(file,'another-binding',initial),/mentor_test_state_binding_mismatch/);
    const reopened=await openFileStore(file,'binding',initial);
    assert.equal(reopened.fresh,false);
    const saved=await reopened.transaction(s=>s);
    assert.equal(saved.clients['1'].status,'hh_ru process');assert.deepEqual(saved.operations['update:1'],{at:1});assert.equal(saved.offset,2);
    await reopened.close();
    assert.doesNotMatch(await readFile(file,'utf8'),/test-mentor-token/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('assembled test worker persists a menu while ignoring other groups and unlisted users',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mentor-worker-'));
  try{
    const state=emptyState([fixtureClient({id:'226',username:'@veu_support'})]);enroll(state,'226',START);
    const store=await openFileStore(join(dir,'state.json'),'worker',state);
    const stop=new AbortController(),sent:string[]=[];let polls=0;
    const scoped=scopeTestTransport({api:{async getUpdates(){if(polls++){stop.abort();return [];}
      return [update(1),update(2,-200),update(3,-100,'stranger')];},async answerCallbackQuery(){}},
      async member(){return true;},async send(input){sent.push(input.chatId);return {kind:'telegram-response',response:{ok:true,
        result:{message_id:9,date:1,chat:{id:-100,type:'supergroup',title:'Test'},text:input.text}}};}},config,'-100');
    try{
      await createMentorWorker({...scoped,store,lock:memoryLock(),reportChatId:config.reportChatId,
        botUsername:config.botUsername,now:()=>START,log(){}}).start(stop.signal);
      assert.deepEqual(sent,['-100']);
      const saved=await store.transaction(s=>s);
      assert.equal(saved.offset,4);assert.equal(Object.keys(saved.sessions).length,1);
    }finally{await store.close();}
  }finally{await rm(dir,{recursive:true,force:true});}
});
