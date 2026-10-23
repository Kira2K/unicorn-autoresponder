function createSelfJoiner({checkInvite,joinInvite,verifyHistory,accountId='8805256389'}){
 let tail=Promise.resolve();
 return async(plan,state,{partial=false}={})=>{let release;const previous=tail;tail=new Promise(r=>release=r);await previous;try{
  if((!state.steps?.invite?.done&&!state.steps?.early_invite?.done)||!state.invitation)throw Error('verified_invitation_required');
  const token=state.invitation.split('/').at(-1).replace(/^\+/,'');
  let result=await checkInvite(token);
  if(result.className==='ChatInviteAlready'){if(String(result.chat?.id)!==state.channel.id)throw Error('self_join_wrong_group');}
  else{await joinInvite(token);result=await checkInvite(token);}
  if(result.className!=='ChatInviteAlready'||String(result.chat?.id)!==state.channel.id)throw Error('self_join_not_verified');
  await verifyHistory(plan,state,result.chat,{partial});
  return{joined:true,userId:String(accountId),chatId:state.chatId,via:'self_invite',historyVerified:true,fullHistoryVerified:!partial};
 }finally{release();}};
}
module.exports={createSelfJoiner};
