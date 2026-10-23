async function ensureRole(receipt,a){
 const current=await a.inspect();
 if(a.matches(current)){const r={...receipt,done:true,verifiedAt:Date.now()};delete r.intent;await a.save(r);return r;}
 if(receipt.intent)throw Error('handoff_role_outcome_unresolved');
 if(current.className==='ChannelParticipantCreator')throw Error('cannot_demote_current_owner');
 if(['ChannelParticipantBanned','ChannelParticipantLeft'].includes(current.className))throw Error('handoff_role_requires_membership');
 receipt={...receipt,intent:true};await a.save(receipt);
 try{await a.change();}catch(e){if(a.matches(await a.inspect())){receipt.done=true;delete receipt.intent;await a.save(receipt);return receipt;}if(e.errorMessage){delete receipt.intent;receipt.error=e.errorMessage;await a.save(receipt);}throw e;}
 for(let i=0;i<3;i++){if(a.matches(await a.inspect())){receipt.done=true;delete receipt.intent;await a.save(receipt);return receipt;}await a.sleep(1000);}
 throw Error('handoff_role_verification_pending');
}
module.exports={ensureRole};
