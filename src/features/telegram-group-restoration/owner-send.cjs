const {hash}=require('./plan.cjs');
const {sameTelegramText}=require('./telegram-text.cjs');
const OWNER='8805256389',BOT='8897025258';
function findReceipt(op,messages,allowed=[OWNER,BOT,'7586552066']){
 const matches=messages.filter(m=>m.className==='Message'&&allowed.includes(String(m.senderId))&&sameTelegramText(op.text,m.message||''));
 if(matches.length!==1)throw Error('send_reconciliation_not_unique');
 const m=matches[0];if(op.file&&Number(m.media?.document?.size)!==op.file.bytes)throw Error('reconciled_file_size_mismatch');
 return{messageId:m.id,senderId:String(m.senderId),reconciled:true};
}
async function sendOwner(op,{client,peer,readFile}){
 const ownerId=client.restorationOwnerId||OWNER;
 try{
  let m;
  if(op.file){const data=readFile(op.file.path);if(data.length!==op.file.bytes||hash(data)!==op.file.sha256)throw Error('attachment_hash_changed');
   const {CustomFile}=require('telegram/client/uploads');
   m=await client.sendFile(peer,{file:new CustomFile(op.file.name,data.length,'',data),caption:op.text,forceDocument:true,parseMode:false,workers:1});
  }else m=await client.sendMessage(peer,{message:op.text,parseMode:false,linkPreview:false});
  if(String(m.senderId)!==ownerId||!sameTelegramText(op.text,m.message||''))throw Error('send_identity_or_content_mismatch');
  return{messageId:m.id,senderId:ownerId};
 }catch(e){const code=e.errorMessage||'';if(code==='FLOOD'||/^FLOOD_WAIT_\d+$/.test(code))return{retryAfter:code==='FLOOD'?900:Number(e.seconds||code.match(/\d+/)[0])+1};throw e;}
}
module.exports={sendOwner,findReceipt,OWNER,BOT};
