const DESIRED=Object.freeze({changeInfo:true,deleteMessages:true,banUsers:true,inviteUsers:true,pinMessages:true,manageCall:true,other:true});
const hasRights=p=>Object.keys(DESIRED).every(k=>p?.adminRights?.[k]===true);
async function grantOne(receipt,a){
 if(receipt.accountId&&receipt.accountId!==a.accountId)throw Error('support_admin_account_mismatch');
 if(receipt.chatId&&receipt.chatId!==a.chatId)throw Error('support_admin_chat_mismatch');
 receipt={...receipt,accountId:a.accountId,chatId:a.chatId};
 const current=await a.getParticipant();
 if(current?.className&&!['ChannelParticipant','ChannelParticipantSelf','ChannelParticipantAdmin','ChannelParticipantCreator'].includes(current.className))throw Error('USER_NOT_PARTICIPANT');
 if(hasRights(current)){receipt.done=true;receipt.status='admin';delete receipt.intent;await a.save(receipt);return receipt;}
 if(receipt.intent)throw Error('support_admin_outcome_unresolved');
 if(receipt.done)throw Error('support_admin_rights_changed');
 const rights={...Object.fromEntries(Object.entries(current.adminRights||{}).filter(([,v])=>v===true)),...DESIRED};
 async function confirmed(){for(let i=0;;i++){if(hasRights(await a.getParticipant()))return true;if(!a.sleep||i>=2)return false;await a.sleep(1000);}}
 receipt.intent=true;await a.save(receipt);
 try{await a.promote(rights,current.rank||'Поддержка');}
 catch(e){
  if(await confirmed()){receipt.done=true;receipt.status='admin';delete receipt.intent;await a.save(receipt);return receipt;}
  if(e.errorMessage){delete receipt.intent;receipt.error=e.errorMessage;await a.save(receipt);}
  throw e;
 }
 if(!await confirmed())throw Error('support_admin_verification_failed');
 receipt.done=true;receipt.status='admin';delete receipt.intent;delete receipt.error;await a.save(receipt);return receipt;
}
module.exports={DESIRED,hasRights,grantOne};
