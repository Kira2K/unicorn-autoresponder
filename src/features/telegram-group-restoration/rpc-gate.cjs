function createRpcGate({invoke,sleep,now=Date.now,load=()=>0,save=()=>{},onWait=()=>{}}){
 let tail=Promise.resolve(),nextAt=Number(load())||0;
 async function execute(request){
  for(let attempt=0;;attempt++){
   await sleep(Math.max(0,nextAt-now()));
   try{const result=await invoke(request);nextAt=Math.max(nextAt,now()+1000);await save(nextAt);return result;}
   catch(e){
    const code=e.errorMessage||'';const explicit=code==='FLOOD'||code.startsWith('FLOOD_WAIT_');
    if(!explicit||attempt>=5){e.rpcMethod=request.className;throw e;}
    const seconds=code==='FLOOD'?Math.min(60*2**attempt,900):Number(e.seconds||code.match(/\d+/)?.[0])+1;
    if(!Number.isFinite(seconds)||seconds<0)throw e;
    nextAt=now()+seconds*1000;await save(nextAt);onWait({method:request.className,seconds,code});
   }
  }
 }
 return async request=>{let release;const previous=tail;tail=new Promise(r=>release=r);await previous;try{return await execute(request);}finally{release();}};
}
module.exports={createRpcGate};
