function checkpointReadiness({plans,states,gate,now,pid,batchPid}){
 if(plans.length!==27||pid!==batchPid||gate.nextAt-now<15000)return {safe:false};
 const rows=plans.map(p=>({plan:p,state:states.get(p.clientId)}));
 const last=Math.max(...rows.map(r=>r.state?.channel?.createdAt||0));
 if(Math.abs(last-(gate.nextAt-60000))>2000)return {safe:false};
 let deadline=gate.nextAt-5000;const queued=[];
 for(const {plan,state:s}of rows){
  if(!s)continue;
  if(s.ownerId!=='8805256389'||Object.values(s.deliveries||{}).some(d=>d.intentAt&&!d.done))return {safe:false};
  if(!s.channel){if(s.lastError&&!/^FLOOD/.test(s.lastError))return{safe:false};if(s.steps?.create?.intentAt)queued.push({clientId:plan.clientId,intentAt:s.steps.create.intentAt});continue;}
  if(s.completedAt)continue;
  if(s.lastError){if(!/^FLOOD/.test(s.lastError))return{safe:false};continue;}
  if(!s.steps?.unicorn_join_early?.done||Object.values(s.steps||{}).some(step=>step.intentAt&&!step.done))return {safe:false};
  const done=Object.values(s.deliveries||{}).filter(d=>d.done).length;
  if(done>=plan.operations.length||!(s.nextSendAt-now>1300))return {safe:false};
  deadline=Math.min(deadline,s.nextSendAt);
 }
 return {safe:true,deadline,queued,gateNextAt:gate.nextAt,checked:rows.length};
}
module.exports={checkpointReadiness};
