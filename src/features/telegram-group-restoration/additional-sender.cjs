async function sendPreferred(op,a){
 let limited=false,rejected=false;
 for(const key of ['bot','unicorn','kira','local']){
  if(!await a.available(key)){limited=true;continue;}
  const result=await a.send(key,op);
  if(result.uncertain)throw Error('send_outcome_unresolved');
  if(result.messageId)return result;
  if(result.limited){limited=true;await a.limit(key,result);continue;}
  if(result.rejected){rejected=true;continue;}
  throw Error('send_outcome_unresolved');
 }
 return {rejected:true,code:rejected&&!limited?'all_senders_rejected':'all_senders_unavailable'};
}
module.exports={sendPreferred};
