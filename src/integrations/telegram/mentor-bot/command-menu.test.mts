import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {configureMentorCommands, MENTOR_MENU_COMMANDS} from './command-menu.mts';

test('slash hints contain only implemented common commands and are scoped to the explicit group',async()=>{
  const calls:unknown[]=[];
  await configureMentorCommands({async setMyCommands(input){calls.push(input);return true;}},'-100');
  assert.deepEqual(MENTOR_MENU_COMMANDS.map(c=>c.command),['menu','what_my_stage','ready_pitch']);
  assert.deepEqual(calls,['','ru'].map(languageCode=>({scope:{type:'chat',chat_id:'-100'},languageCode,
    commands:MENTOR_MENU_COMMANDS})));
});

test('invalid group IDs cannot register a global or private command menu',async()=>{
  let calls=0;
  for(const chatId of ['', '123', '@group', '-1.5', '-9007199254740992'])
    await assert.rejects(configureMentorCommands({async setMyCommands(){calls++;return true;}},chatId));
  assert.equal(calls,0);
});

test('command registration does not hide a native failure or retry it',async()=>{
  let calls=0;const failure=Error('test');
  await assert.rejects(configureMentorCommands({async setMyCommands(){calls++;throw failure;}},'-100'),error=>error===failure);
  assert.equal(calls,1);
});

test('the shared HTTP client sets and reads native command metadata without sending or polling',async()=>{
  const require=createRequire(import.meta.url);
  const {createTelegramBotApi}=require('../bot-api.ts') as typeof import('../bot-api.ts');
  const calls:{method:string;body:unknown}[]=[];
  const api=createTelegramBotApi({token:'synthetic',requester:async(url,options)=>{
    const method=url.split('/').at(-1)!;calls.push({method,body:JSON.parse(String(options.body))});
    return {ok:true,status:200,json:async()=>({ok:true,result:method==='getMyCommands'?MENTOR_MENU_COMMANDS:true})};
  }});
  const scope={type:'chat' as const,chat_id:'-100'};
  await configureMentorCommands(api,'-100');
  assert.deepEqual(await api.getMyCommands({scope,languageCode:'ru'}),MENTOR_MENU_COMMANDS);
  assert.deepEqual(calls.map(c=>c.method),['setMyCommands','setMyCommands','getMyCommands']);
  assert.deepEqual(calls[1].body,{scope,language_code:'ru',commands:MENTOR_MENU_COMMANDS});
});

test('malformed command definitions fail before HTTP and malformed readback is not accepted',async()=>{
  const require=createRequire(import.meta.url);
  const {createTelegramBotApi}=require('../bot-api.ts') as typeof import('../bot-api.ts');
  let calls=0;
  const api=createTelegramBotApi({token:'synthetic',requester:async()=>{
    calls++;return {ok:true,status:200,json:async()=>({ok:true,result:[{command:'menu'}]})};
  }});
  const scope={type:'chat' as const,chat_id:'-100'};
  await assert.rejects(api.setMyCommands({scope,commands:[{command:'/menu',description:'Menu'}]}));
  await assert.rejects(api.setMyCommands({scope,commands:[{command:'menu',description:''}]}));
  assert.equal(calls,0);await assert.rejects(api.getMyCommands({scope}));assert.equal(calls,1);
});
