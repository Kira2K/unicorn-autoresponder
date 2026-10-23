// An uncertain send is reconciled on its original account; it never authorizes fallback.
async function deliverOnce(receipt,a){
 if(receipt.done)return receipt;
 if(receipt.intent){const found=await a.reconcile(receipt.intent);if(!found){receipt.status='uncertain';await a.save(receipt);return receipt;}Object.assign(receipt,{done:true,status:'sent',result:found});await a.save(receipt);return receipt;}
 for(const account of ['owner','observer']){
  const valid=await a.validate();if(!valid.ok){receipt.status='skipped';receipt.reason=valid.reason;await a.save(receipt);return receipt;}
  if(!await a.available(account))continue;
  receipt.intent={account,at:a.now()};await a.save(receipt);
  let r;try{r=await a.send(account);}catch(e){receipt.status='uncertain';await a.save(receipt);throw e;}
  if(r.rejected){delete receipt.intent;(receipt.rejections||=[]).push({account,...r});await a.save(receipt);continue;}
  if(!r.messageId){receipt.status='uncertain';await a.save(receipt);return receipt;}
  Object.assign(receipt,{done:true,status:'sent',result:{...r,account}});await a.save(receipt);return receipt;
 }
 receipt.status='deferred';receipt.reason='no_confirmed_available_sender';await a.save(receipt);return receipt;
}
module.exports={deliverOnce};
