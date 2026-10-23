function createReadGate({invoke,sleep,now=Date.now,onWait=()=>{},intervalMs=3100}){
 let tail=Promise.resolve(),nextAt=0;
 return request=>{const task=tail.catch(()=>{}).then(async()=>{
  if(!/\.(?:Get\w*|Search\w*|ResolveUsername|CheckChatInvite)$/.test(request.className||''))throw Error('read_rpc_required');
  for(let attempt=0;;attempt++){
   await sleep(Math.max(0,nextAt-now()));
   try{const result=await invoke(request);nextAt=now()+intervalMs;return result;}
   catch(e){e.rpcMethod=request.className;const seconds=Number(e.seconds||String(e.errorMessage||'').match(/^FLOOD_WAIT_(\d+)$/)?.[1]);
    if(attempt>=3||!/^FLOOD(?:_WAIT_\d+)?$/.test(e.errorMessage||'')||!Number.isFinite(seconds)||seconds<=0)throw e;
    nextAt=now()+(seconds+1)*1000;await onWait({method:request.className,seconds,notBefore:nextAt});
   }
  }
 });tail=task;return task;};
}
function paceReadCalls(a){const read=createReadGate(a);return request=>/\.(?:Get\w*|Search\w*|ResolveUsername|CheckChatInvite)$/.test(request.className||'')?read(request):a.invoke(request);}
module.exports={createReadGate,paceReadCalls};
