async function checkServices(checks) {
  const results=await Promise.all(checks.map(async ({name,run,timeoutMs=30000})=>{
    const start=Date.now(),controller=new AbortController();let timer;
    try{
      const details=await Promise.race([Promise.resolve().then(()=>run(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('service_check_timeout'));},timeoutMs);})]);
      return {name,ok:true,durationMs:Date.now()-start,details};
    }catch(error){return {name,ok:false,durationMs:Date.now()-start,code:/^[a-z][a-z0-9_]{2,80}$/.test(error.message)?error.message:'service_check_failed'};}
    finally{clearTimeout(timer);controller.abort();}
  }));
  return {at:new Date().toISOString(),ok:results.every(x=>x.ok),checks:results};
}
module.exports={checkServices};
