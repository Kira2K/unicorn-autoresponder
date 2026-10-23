function createPreparationGate(pilotId){
 let resolve,reject,ready=false;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});
 function prepared(state){if(state.clientId!==pilotId)return;
  const join=state.steps?.unicorn_join_early?.result||state.steps?.unicorn_join?.result;
  const sent=Object.values(state.deliveries||{}).filter(d=>d.done);
  if(!join?.joined||!join.historyVerified||!sent.length||sent.some(d=>d.result.senderId!=='8897025258'))throw Error('parallel_preparation_not_verified');
  ready=true;resolve();
 }
 return{before:async(id,complete)=>{if(!complete&&id!==pilotId)await promise;},prepared,failed:id=>{if(id===pilotId&&!ready)reject(Error('pilot_preparation_failed'));},get ready(){return ready;}};
}
module.exports={createPreparationGate};
