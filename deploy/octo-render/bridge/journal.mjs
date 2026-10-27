import { open,readFile,mkdir,rename,unlink } from 'node:fs/promises';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { failure } from './agent.mjs';
export function machineIdentity(){
 if(process.platform==='win32'){
  const result=execFileSync('reg.exe',['query','HKLM\\SOFTWARE\\Microsoft\\Cryptography','/v','MachineGuid'],{encoding:'utf8',windowsHide:true});
  const id=result.match(/REG_SZ\s+([a-f0-9-]{36})/i)?.[1];if(!id)throw failure('bridge_machine_identity_unavailable');
  return createHash('sha256').update(id.toLowerCase()).digest('hex');
 }
 return createHash('sha256').update(hostname()).digest('hex');
}
export async function openJournal(path,config,machine=machineIdentity()){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const lock=await open(`${path}.lock`,'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid,machine}));
 const release=async()=>{await lock.close();await unlink(`${path}.lock`);};
 const identity=createHash('sha256').update(JSON.stringify([config.backendUrl,config.bridgeId,config.ownerEmail])).digest('hex');
 try{
  let data;try{const bytes=await readFile(path);if(bytes.length>8000000)throw failure('bridge_journal_invalid');data=JSON.parse(bytes.toString('utf8'));}
  catch(e){if(e.code!=='ENOENT')throw e;data={schema:1,identity,machine,deviceId:randomBytes(32).toString('hex'),entries:{}};}
  if(data.schema!==1||data.identity!==identity||data.machine!==machine||!/^[a-f0-9]{64}$/.test(data.deviceId??'')||
   !data.entries||Array.isArray(data.entries)||typeof data.entries!=='object')throw failure('bridge_journal_identity_mismatch');
  for(const [id,entry]of Object.entries(data.entries))if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||!entry||
   !/^[a-f0-9]{32}$/.test(entry.uuid??'')||!/^[a-f0-9]{64}$/.test(entry.digest??'')||
   !['received','executing','uncertain'].includes(entry.stage)||entry.result&&!['succeeded','rejected','uncertain'].includes(entry.result.state))throw failure('bridge_journal_invalid');
  let failed=false,closed=false;
  const save=async()=>{
   if(failed||closed)throw failure('bridge_journal_unavailable');
   const tmp=`${path}.${randomUUID()}.tmp`;
   try{const file=await open(tmp,'wx',0o600);try{await file.writeFile(JSON.stringify(data,null,2));await file.sync();}finally{await file.close();}await rename(tmp,path);}
   catch{failed=true;throw failure('bridge_journal_write_failed');}
  };
  await save();return{data,save,async close(){closed=true;await release();}};
 }catch(e){await release();throw e;}
}
