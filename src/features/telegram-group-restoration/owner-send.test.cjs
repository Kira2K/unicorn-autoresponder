const {test}=require('node:test'),assert=require('node:assert/strict');
const {sendOwner,findReceipt,OWNER,BOT}=require('./owner-send.cjs'),{hash}=require('./plan.cjs');
const {restoredCopies}=require('./verify.cjs');
const msg=(id,text,senderId)=>({id,message:text,senderId,className:'Message'});
test('owner sends literal unchanged text once, returns explicit FLOOD, never retries uncertain sends',async()=>{
 const op={text:'**literal** @tag',hash:hash('**literal** @tag')};let calls=0;
 const client={async sendMessage(peer,args){calls++;assert.equal(args.parseMode,false);assert.equal(args.linkPreview,false);return msg(42,args.message,OWNER);}};
 assert.deepEqual(await sendOwner(op,{client,peer:{}}),{messageId:42,senderId:OWNER});assert.equal(calls,1);
 client.sendMessage=async()=>{throw Object.assign(Error(),{errorMessage:'FLOOD_WAIT_12',seconds:12});};assert.deepEqual(await sendOwner(op,{client,peer:{}}),{retryAfter:13});
 client.sendMessage=async()=>{throw Error('connection_lost');};await assert.rejects(sendOwner(op,{client,peer:{}}),/connection_lost/);
});
test('mixed authors verify chronologically and reconcile old bot deliveries without resending',()=>{
 const operations=['old','new'].map(text=>({text,hash:hash(text)})),p={sourceChatId:'-1',operations};
 const rows=[msg(1,'old',BOT),msg(2,'new',OWNER)];assert.equal(restoredCopies(p,rows).length,2);
 assert.equal(findReceipt(operations[0],rows).senderId,BOT);assert.equal(findReceipt(operations[1],rows).senderId,OWNER);
 assert.throws(()=>findReceipt(operations[0],[...rows,msg(3,'old',OWNER)]),/not_unique/);
 assert.throws(()=>restoredCopies(p,[...rows,msg(3,'new',BOT)]),/count/);
});
