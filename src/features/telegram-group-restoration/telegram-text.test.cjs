const {test}=require('node:test'),assert=require('node:assert/strict');
const {sameTelegramText}=require('./telegram-text.cjs'),{restoredCopies}=require('./verify.cjs'),{findReceipt}=require('./owner-send.cjs'),{hash}=require('./plan.cjs');
test('only Telegram terminal ASCII whitespace removal is accepted; source hash and receipt stay unchanged',()=>{
 const text='#src_1_42 body ',op={text,hash:hash(text)},p={sourceChatId:'-1',operations:[op]},m={className:'Message',id:42,senderId:'8897025258',message:text.trimEnd()};
 assert.equal(sameTelegramText(text,m.message),true);assert.equal(restoredCopies(p,[m]).length,1);assert.equal(findReceipt(op,[m]).messageId,42);assert.equal(op.hash,hash(text));
 for(const changed of ['#src_1_42 different','#src_1_42  body',' '+text.trimEnd(),text+' ']){assert.equal(sameTelegramText(text,changed),false);assert.throws(()=>restoredCopies(p,[{...m,message:changed}]));}
 assert.throws(()=>restoredCopies(p,[m,{...m,id:43}]),/count/);
});
