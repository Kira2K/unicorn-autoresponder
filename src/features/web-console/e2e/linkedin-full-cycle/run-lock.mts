import { open, unlink, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/** A crashed run leaves evidence for review; another process must not repeat its external calls. */
export async function lockCycleRun(directory: string,fixtureRunId?:string):Promise<()=>Promise<void>> {
  if(fixtureRunId){
    if(!/^[a-z0-9-]{8,64}$/.test(fixtureRunId))throw Error('e2e_invalid_run_id');
    const releaseOwn=await lockCycleRun(directory),shared=resolve('tmp/linkedin-fixture-locks',fixtureRunId);
    try{await mkdir(shared,{recursive:true});const releaseShared=await lockCycleRun(shared);return async()=>{try{await releaseShared();}finally{await releaseOwn();}};}
    catch(error){await releaseOwn();throw error;}
  }
  const file = resolve(directory, 'run.lock');
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Error('e2e_run_already_locked'); throw error; }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); await handle.sync(); }
  finally { await handle.close(); }
  return async () => { await unlink(file); };
}
