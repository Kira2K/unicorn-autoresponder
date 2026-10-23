const {createSelfJoiner}=require('./self-join.cjs');
async function joinOne(plan,state,receipt,a){
 if(receipt.accountId&&receipt.accountId!==a.accountId)throw Error('support_receipt_account_mismatch');
 if(receipt.chatId&&receipt.chatId!==state.chatId)throw Error('support_receipt_group_mismatch');
 if(receipt.done)return receipt;
 Object.assign(receipt,{accountId:a.accountId,clientId:plan.clientId,chatId:state.chatId});
 const run=createSelfJoiner({accountId:a.accountId,verifyHistory:a.verifyHistory,checkInvite:async token=>{const r=await a.checkInvite(token);if(receipt.initialMembership===undefined){receipt.initialMembership=r.className==='ChatInviteAlready';await a.save(receipt);}return r;},joinInvite:async token=>{
  if(receipt.intentAt)throw Error('support_join_outcome_unresolved');
  await a.waitForSlot();receipt.intentAt=a.now();await a.save(receipt);
  try{await a.joinInvite(token);receipt.accepted=true;await a.save(receipt);}
  catch(e){if(e.errorMessage){if(e.errorMessage==='USER_ALREADY_PARTICIPANT')return;delete receipt.intentAt;await a.save(receipt);}throw e;}
  finally{await a.advanceSlot();}
 }});
 try{
  let result;try{result=await run(plan,state,{partial:!state.completedAt&&!state.complete});}
  catch(e){if(receipt.intentAt&&!e.errorMessage){const check=await a.checkInvite(state.invitation.split('/').at(-1).replace(/^\+/,''));if(check.className!=='ChatInviteAlready'||String(check.chat?.id)!==state.channel.id)throw Error('support_join_outcome_unresolved');result=await run(plan,state,{partial:!state.completedAt&&!state.complete});}else throw e;}
  Object.assign(receipt,{done:true,status:receipt.initialMembership?'already_member':'joined',result,verifiedAt:a.now()});delete receipt.error;delete receipt.retryAt;await a.save(receipt);return receipt;
 }catch(e){const code=e.errorMessage||e.message||'support_join_failed';
  const seconds=Number(e.seconds||String(code).match(/^FLOOD_WAIT_(\d+)$/)?.[1]);
  if(/^FLOOD(?:_WAIT_\d+)?$/.test(code)&&Number.isFinite(seconds)&&seconds>0){Object.assign(receipt,{status:'waiting',error:code,retryAt:a.now()+(seconds+1)*1000});}
  else Object.assign(receipt,{status:'error',error:/^[\w:-]{1,120}$/.test(code)?code:'support_join_failed',stopAccount:code==='FLOOD'});
  if(e.rpcMethod)receipt.errorMethod=e.rpcMethod;await a.save(receipt);return receipt;
 }
}
module.exports={joinOne};
