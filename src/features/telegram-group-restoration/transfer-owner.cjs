const SCOPE={clientId:'143',chatId:'-1003721937418',from:'343610488',to:'8805256389'};
function readiness({state,authorizedAt,now=Date.now(),runnerActive=false},scope=SCOPE){
 if(state?.clientId!==scope.clientId||state.chatId!==scope.chatId||state.ownerId!==scope.from)throw Error('ownership_transfer_scope_mismatch');
 const notBefore=Date.parse(authorizedAt)+86400000;if(!Number.isFinite(notBefore))throw Error('authorization_time_missing');
 if(now<notBefore)return{ready:false,reason:'session_too_young',notBefore};
 if(!state.completedAt)return{ready:false,reason:'restoration_incomplete',notBefore};
 if(runnerActive)return{ready:false,reason:'runner_active',notBefore};
 return{ready:true,notBefore};
}
async function transferOnce(receipt,a,scope=SCOPE){
 const authorized=scope.from==='7586552066'&&scope.to===SCOPE.to&&typeof scope.planHash==='string'&&scope.planHash.length>0&&a.authorizedScope&&['clientId','chatId','from','to','planHash'].every(k=>a.authorizedScope[k]===scope[k]);
 if((scope.from!==SCOPE.from&&!authorized)||scope.to!==SCOPE.to||!/^\d+$/.test(scope.clientId)||!/^\-100\d+$/.test(scope.chatId))throw Error('ownership_transfer_scope_mismatch');
 if(receipt.clientId&&["clientId","chatId","from","to"].some(k=>receipt[k]!==scope[k]))throw Error('ownership_receipt_scope_mismatch');
 if(receipt.done||receipt.blocked)return receipt;
 const before=await a.inspect();
 if(receipt.intentAt){
  if(before.ownerId!==scope.to){const blocked={...receipt,blocked:true,error:'transfer_outcome_unresolved'};await a.save(blocked);return blocked;}
  await a.verify(receipt.baseline);const done={...receipt,done:true,reconciled:true,verifiedAt:a.now()};await a.save(done);return done;
 }
 if(before.ownerId===scope.to){await a.verify(before.digest);const done={...scope,done:true,alreadyTransferred:true,verifiedAt:a.now()};await a.save(done);return done;}
 if(before.ownerId!==scope.from||!before.serviceMember)throw Error('ownership_precondition_failed');
 let proof=await a.prepare();
 const intent={...scope,intentAt:a.now(),baseline:before.digest};await a.save(intent);
 try{await a.transfer(proof);}catch(e){
  const code=e.errorMessage||e.code;const explicit=!!e.errorMessage||Number.isInteger(e.code);
  if(explicit){const value=String(code),seconds=Number(e.seconds||value.match(/(?:WAIT|FRESH)_(\d+)$/)?.[1]);const blocked={...intent,blocked:true,error:/^[A-Z0-9_]+$/.test(value)?value:'telegram_rejected',retryNotBefore:Number.isFinite(seconds)&&seconds>0?a.now()+seconds*1000:undefined};await a.save(blocked);return blocked;}
  const after=await a.inspect();if(after.ownerId!==scope.to){const blocked={...intent,blocked:true,error:'transfer_outcome_unresolved'};await a.save(blocked);return blocked;}
 }finally{proof=undefined;}
 await a.verify(intent.baseline);const done={...intent,done:true,verifiedAt:a.now()};await a.save(done);return done;
}
module.exports={SCOPE,readiness,transferOnce};
