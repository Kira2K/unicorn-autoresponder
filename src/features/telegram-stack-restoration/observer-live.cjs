const path=require('node:path');
const {OUT,FOLDER,read,save,file,sleep,Api,bi,ACCOUNTS,report}=require('./context.cjs');
const {joinOne}=require('../telegram-group-restoration/support-join-one.cjs');
const {restoredCopies}=require('../telegram-group-restoration/verify.cjs');
async function verifyObserver(plan,state,client,rpc,write=action=>action()){
 const receiptFile=file('observer-'+plan.stackKey),rateFile=file('observer-join-rate');
 const peer=()=>new Api.InputPeerChannel({channelId:bi(state.observerChannel.id),accessHash:bi(state.observerChannel.accessHash)});
 let r=read(receiptFile)||{};
 if(r.retryAt>Date.now())while(Date.now()<r.retryAt)await sleep(Math.min(50000,r.retryAt-Date.now()));
 if(r.stopAccount)throw Error('observer_stopped_after_bare_flood');
 r=await joinOne({...plan,clientId:plan.stackKey},state,r,{accountId:ACCOUNTS.observer,now:Date.now,save:r=>save(receiptFile,r),
  checkInvite:hash=>rpc(client,new Api.messages.CheckChatInvite({hash})),joinInvite:hash=>rpc(client,new Api.messages.ImportChatInvite({hash})),
  waitForSlot:async()=>{const until=Math.max(read(rateFile)?.nextAt||0,read(path.join(OUT,'../group-handoff-20261019/join-rate-'+ACCOUNTS.observer+'.json'))?.nextAt||0);while(Date.now()<until)await sleep(Math.min(50000,until-Date.now()));},
  advanceSlot:async()=>save(rateFile,{nextAt:Date.now()+60000}),
  verifyHistory:async(p,s,chat)=>{const input=await client.getInputEntity(chat);s.observerChannel={id:String(input.channelId),accessHash:String(input.accessHash)};
   const full=await rpc(client,new Api.channels.GetFullChannel({channel:input}));if(full.fullChat.hiddenPrehistory)throw Error('observer_history_hidden');
   const rows=[];for await(const message of client.iterMessages(input,{}))rows.push(message);const copies=restoredCopies(p,rows,[ACCOUNTS.owner]);
   if(copies.some((message,i)=>message.id!==s.deliveries[p.operations[i].key].result.messageId))throw Error('observer_history_receipt_mismatch');
   save(file('group-'+p.stackKey),s);
  }
 });
 if(!r.done)throw Object.assign(Error(r.error||'observer_join_not_complete'),{code:r.error,retryAt:r.retryAt});
 if(!state.observerChannel){const checked=await rpc(client,new Api.messages.CheckChatInvite({hash:state.invitation.split('/').at(-1).replace(/^\+/,'' )}));if(checked.className!=='ChatInviteAlready'||String(checked.chat.id)!==state.channel.id)throw Error('observer_membership_lost');const input=await client.getInputEntity(checked.chat);state.observerChannel={id:String(input.channelId),accessHash:String(input.accessHash)};}
 const member=(await rpc(client,new Api.channels.GetParticipant({channel:peer(),participant:new Api.InputPeerSelf()}))).participant;
 if(!['ChannelParticipant','ChannelParticipantSelf'].includes(member.className))throw Error('observer_not_ordinary_member');
 const testFile=file('observer-write-'+plan.stackKey),test=read(testFile)||{},text='Тестовое сообщение, не обращайте внимание';
 if(!test.deleted){
  if(!test.intentAt){test.intentAt=Date.now();save(testFile,test);try{const m=await write(()=>client.sendMessage(peer(),{message:text,parseMode:false,linkPreview:false}));if(String(m.senderId)!==ACCOUNTS.observer||m.message!==text)throw Error('observer_test_identity_mismatch');test.messageId=m.id;test.verified=true;save(testFile,test);}catch(e){test.error=e.errorMessage||e.code||'uncertain';save(testFile,test);throw e;}}
  if(!test.messageId){const rows=await client.getMessages(peer(),{limit:50});const found=rows.filter(m=>String(m.senderId)===ACCOUNTS.observer&&m.message===text&&m.date*1000>=test.intentAt-5000);if(found.length!==1)throw Error('observer_test_outcome_unresolved');test.messageId=found[0].id;test.verified=true;save(testFile,test);}
  const m=(await client.getMessages(peer(),{ids:[test.messageId]}))[0];
  if(m?.className==='Message'){if(String(m.senderId)!==ACCOUNTS.observer||m.message!==text)throw Error('observer_test_cleanup_identity_mismatch');test.deleteIntentAt=Date.now();save(testFile,test);await write(()=>client.deleteMessages(peer(),[test.messageId],{revoke:true}));}
  else if(!test.deleteIntentAt)throw Error('observer_test_missing_before_delete');
  if((await client.getMessages(peer(),{ids:[test.messageId]}))[0]?.className==='Message')throw Error('observer_test_cleanup_failed');
  test.deleted=true;test.deletedAt=Date.now();save(testFile,test);
 }
 report('stack_observer_verified',{stack:plan.stackKey,messages:plan.operations.length,writeTestDeleted:true});
 return{observerId:ACCOUNTS.observer,ordinaryMember:true,historyVerified:true,writeVerified:true,testDeleted:true};
}
module.exports={verifyObserver};
