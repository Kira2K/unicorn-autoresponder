// Only read-only preflight operations may use this helper. Never retry sends or applications.
async function withTransientReadRetry(read,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),onRetry=()=>{}}={}) {
 for(let attempt=1;;attempt++) {
  try{return await read();}
  catch(error){
   if(attempt>=3||!['postgres_read_unavailable','postgres_connection_failed','ECONNRESET','ETIMEDOUT'].includes(error.code??error.message))throw error;
   onRetry({attempt,code:error.code??error.message});await sleep(attempt*2000);
  }
 }
}
module.exports={withTransientReadRetry};
