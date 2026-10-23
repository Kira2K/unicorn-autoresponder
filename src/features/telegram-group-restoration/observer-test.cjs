const path=require('node:path');
const {FOLDER,read,save,report,Api,openCreator}=require('./live.cjs');
async function testObserver(plan,state){
 const receiptFile=path.join(FOLDER,'new-member-test-kira.json');if(read(receiptFile)?.done)return;
 const c=openCreator('unicorn');let peer,joined=false;
 try{
  await c.connect();if(String((await c.getMe()).id)!=='8805256389')throw Error('test_account_mismatch');
  const inviteHash=state.invitation.split('/').at(-1).replace(/^\+/,'');
  const check=await c.invoke(new Api.messages.CheckChatInvite({hash:inviteHash}));
  if(check.className==='ChatInviteAlready'&&!read(receiptFile)?.joinIntent)throw Error('test_account_already_member');
  save(receiptFile,{joinIntent:true,chatId:state.chatId});
  if(check.className!=='ChatInviteAlready')await c.invoke(new Api.messages.ImportChatInvite({hash:inviteHash}));
  joined=true;const d=(await c.getDialogs({limit:250})).find(d=>String(d.id)===state.chatId);if(!d)throw Error('test_group_not_visible');
  peer=await c.getInputEntity(d.entity);const messages=[];for await(const m of c.iterMessages(d.inputEntity,{}))messages.push(m);
  const copies=require('./verify.cjs').restoredCopies(plan,messages,[state.ownerId,'8897025258']);
  await c.invoke(new Api.channels.LeaveChannel({channel:peer}));joined=false;
  save(receiptFile,{done:true,chatId:state.chatId,messages:copies.length,observerId:'8805256389',verifiedAt:new Date().toISOString(),left:true});
  report('new_member_history_verified',{chatId:state.chatId,messages:copies.length});
 }finally{try{if(joined&&peer)await c.invoke(new Api.channels.LeaveChannel({channel:peer}));}finally{await c.disconnect();}}
}
module.exports={testObserver};
