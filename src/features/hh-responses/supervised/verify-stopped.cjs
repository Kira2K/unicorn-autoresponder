// Dolphin's running registry can lag behind successful browser process shutdown.
async function verifyStopped(ids,{readRunning,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,timeoutMs=30000}={}){
 const owned=new Set(ids.map(Number)),deadline=now()+timeoutMs;
 for(;;){
  const running=await readRunning();
  const remaining=Object.keys(running).map(Number).filter(id=>owned.has(id));
  if(!remaining.length||now()>=deadline)return remaining;
  await sleep(Math.min(1000,Math.max(0,deadline-now())));
 }
}
module.exports={verifyStopped};
