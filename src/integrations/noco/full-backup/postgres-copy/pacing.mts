import fs from 'node:fs';
export interface Timing { now():number; sleep(ms:number):Promise<void>; }
export async function resumePacing(file:string,timing:Timing={now:Date.now,sleep:ms=>new Promise(r=>setTimeout(r,ms))}) {
  let blockedUntil=0;
  try { const saved=JSON.parse(fs.readFileSync(file,'utf8')) as {blockedUntil:number};
    if(!Number.isFinite(saved.blockedUntil))throw new Error('invalid_cooldown_journal'); blockedUntil=saved.blockedUntil;
  } catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  // Starting another command ends a partial batch with a full pause, never a fresh burst.
  await timing.sleep(Math.max(1000,blockedUntil-timing.now()));
  return (event:Record<string,unknown>)=>{
    if(event.event!=='cooldown_started')return;
    blockedUntil=Math.max(blockedUntil,timing.now()+Number(event.waitMs));
    fs.writeFileSync(file+'.next',JSON.stringify({blockedUntil}),{mode:0o600});
    fs.renameSync(file+'.next',file);
  };
}
