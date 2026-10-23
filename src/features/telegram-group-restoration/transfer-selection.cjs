const FROM='343610488',TO='8805256389';
function selectTargets(plans,states,{creatorId}){
 return plans.filter(p=>p.clientId!=='92').flatMap(p=>{const s=states.get(p.clientId);if(s?.skipped)return[];
  const existing=s?.channel&&s.ownerId===FROM,pending=!s?.channel&&!s?.completedAt&&creatorId===FROM;
  return existing||pending?[{clientId:p.clientId,chatId:existing?s.chatId:null,planHash:p.planHash,from:FROM,to:TO}]:[];
 }).sort((a,b)=>Number(a.clientId)-Number(b.clientId));
}
function bindTarget(target,state){
 if(state?.skipped&&!state.channel)return{...target,excluded:true};
 if(!state?.channel)return target;
 if(state.clientId!==target.clientId||state.ownerId!==FROM||state.planHash!==target.planHash||(target.chatId&&target.chatId!==state.chatId)||String(-1000000000000n-BigInt(state.channel.id))!==state.chatId)throw Error('transfer_target_scope_changed');
 return{...target,chatId:state.chatId};
}
module.exports={FROM,TO,selectTargets,bindTarget};
