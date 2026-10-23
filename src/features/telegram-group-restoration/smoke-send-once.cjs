async function sendOnce(receipt,a){
 if(receipt.done)return receipt;
 if(receipt.intentAt){const found=await a.reconcile(receipt.intentAt);if(!found){receipt.status='uncertain';await a.save(receipt);return receipt;}Object.assign(receipt,{done:true,status:'sent',...found});await a.save(receipt);return receipt;}
 receipt.intentAt=a.now();await a.save(receipt);const result=await a.send();
 if(result.rejected){delete receipt.intentAt;Object.assign(receipt,{status:'rejected',error:result.error,code:result.code,retryAfter:result.retryAfter});}
 else if(result.messageId)Object.assign(receipt,{done:true,status:'sent',messageId:result.messageId,verified:!!result.verified});
 else{receipt.status='uncertain';}
 await a.save(receipt);return receipt;
}
module.exports={sendOnce};
