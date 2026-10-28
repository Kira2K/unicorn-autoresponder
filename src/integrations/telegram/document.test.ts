import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createTelegramIntegration} from './integration.ts'
import type {SendOneInput} from './types.ts'
const attachment:NonNullable<SendOneInput['attachment']>={fileName:'проверка.pdf',mimeType:'application/pdf',data:new TextEncoder().encode('%PDF-fixture')}
const response={ok:true as const,result:{message_id:7,date:1,chat:{id:42,type:'private' as const,first_name:'Test'},document:{file_id:'file',file_unique_id:'unique',file_name:'проверка.pdf'},caption:'Report',future:{retained:true}}}
function fixture(value:unknown=response){
 const calls:Array<{url:string;options:Record<string,unknown>}>=[],logs:unknown[]=[]
 const bot=createTelegramIntegration({token:'fixture',regularErrorChatId:'',summaryLogsChatId:'',logger:e=>logs.push(e),requester:async(url,options)=>{
  calls.push({url,options});return{ok:true,status:200,json:async()=>value}
 }})
 return{bot,calls,logs}
}
test('one document is one multipart sendDocument request, preserving native response and private bytes',async()=>{
 const f=fixture(),result=await f.bot.sendOne({chatId:'42',text:'Report',attachment})
 assert.deepEqual(result,{kind:'telegram-response',response})
 assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.endsWith('/sendDocument'))
 assert.equal(f.calls[0].options.headers,undefined,'fetch must supply the multipart boundary')
 const body=f.calls[0].options.body as FormData
 assert.equal(body.get('chat_id'),'42');assert.equal(body.get('caption'),'Report')
 const file=body.get('document') as File;assert.equal(file.name,'проверка.pdf');assert.equal(file.type,'application/pdf')
 assert.equal(await file.text(),'%PDF-fixture');assert.ok(!JSON.stringify(f.logs).includes('%PDF-fixture'))
 assert.ok(!JSON.stringify(f.logs).includes('проверка.pdf'))
})
test('invalid uploads and edits fail before HTTP, while ordinary text remains JSON',async()=>{
 for(const change of [{attachment:{...attachment,data:new Uint8Array()}},{attachment:{...attachment,fileName:'../report.pdf'}},
  {attachment:{...attachment,data:new TextEncoder().encode('not a PDF')}},
  {attachment:{...attachment,data:new Uint8Array(5*1024*1024+1)}},{text:'x'.repeat(1025)},{editMessageId:1},{linkPreviewOptions:{is_disabled:true}}]){
  const f=fixture(),result=await f.bot.sendOne({chatId:'42',text:'Report',attachment,...change} as SendOneInput)
  assert.equal(result.kind,'client-failure');assert.equal(f.calls.length,0)
 }
 const f=fixture({ok:true,result:{message_id:1,date:1,chat:{id:42,type:'private'},text:'text'}})
 await f.bot.sendOne({chatId:'42',text:'text'});assert.ok(f.calls[0].url.endsWith('/sendMessage'))
 assert.equal(typeof f.calls[0].options.body,'string')
})
test('document rejection and unknown response never fall back to another send',async()=>{
 for(const value of [{ok:false,error_code:403,description:'forbidden'},{ok:true,result:{message_id:1,date:1,chat:{id:42,type:'private'},document:{}}}]){
  const f=fixture(value);const result=await f.bot.sendOne({chatId:'42',text:'Report',attachment})
  assert.equal(f.calls.length,1)
  assert.equal(result.kind,'error_code' in value?'telegram-response':'client-failure')
 }
 let calls=0;const bot=createTelegramIntegration({token:'fixture',regularErrorChatId:'',summaryLogsChatId:'',logger(){},requester:async()=>{calls++;throw Error('lost')}})
 const result=await bot.sendOne({chatId:'42',text:'Report',attachment});assert.equal(result.kind,'client-failure');assert.equal(calls,1)
})
test('documents fail closed with text-only responses or legacy text adapters',async()=>{
 const f=fixture({ok:true,result:{message_id:1,date:1,chat:{id:42,type:'private'},text:'ignored file'}})
 assert.equal((await f.bot.sendOne({chatId:'42',text:'Report',attachment})).kind,'client-failure')
 let calls=0
 const bot=createTelegramIntegration({token:'fixture',regularErrorChatId:'',summaryLogsChatId:'',logger(){},botApi:{async sendMessageResponse(){calls++;return response}}})
 assert.equal((await bot.sendOne({chatId:'42',text:'Report',attachment})).kind,'client-failure');assert.equal(calls,0)
})
test('transport exceptions cannot copy private document bytes or captions into logs',async()=>{
 const logs:unknown[]=[]
 const bot=createTelegramIntegration({token:'fixture',regularErrorChatId:'',summaryLogsChatId:'',logger:e=>logs.push(e),requester:async()=>{
  throw Object.assign(Error('%PDF-private-payload'),{caption:'private-password',data:attachment.data})
 }})
 const result=await bot.sendOne({chatId:'42',text:'private-password',attachment})
 const serialized=JSON.stringify({logs,result});assert.ok(!serialized.includes('private-password'));assert.ok(!serialized.includes('%PDF-private-payload'))
})
