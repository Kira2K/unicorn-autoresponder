import { readFile,writeFile,unlink,mkdir,stat } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent,parseConfig } from './agent.mjs';
import { openJournal } from './journal.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),index=args.indexOf('--config');
const configPath=resolve(index<0?resolve(root,'bridge.config.json'):args[index+1]??'');
let journal,stop=false,wake,lastOutput='',lastOutputAt=0;
const shutdown=()=>{stop=true;wake?.();};
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
const output=value=>console.log(JSON.stringify(value));
try{
 const config=parseConfig(JSON.parse(await readFile(configPath,'utf8')));
 const stateRoot=resolve(dirname(configPath),'.state'),stopPath=resolve(stateRoot,'stop.request');
 if(args.includes('--stop')){
  await mkdir(stateRoot,{recursive:true,mode:0o700});await writeFile(stopPath,'stop',{mode:0o600});output({stopRequested:true});
 }else if(args.includes('--check')){
  output(await createAgent({config,journal:{data:{deviceId:''}}}).check());
 }else{
 journal=await openJournal(resolve(stateRoot,'journal.json'),config);
 await unlink(stopPath).catch(e=>{if(e.code!=='ENOENT')throw e;});
 const agent=createAgent({config,journal});
 do{
  let status;
  try{status=await agent.step();}catch(e){status={error:/^bridge_[a-z0-9_]{1,100}$/.test(e.code??'')?e.code:'bridge_unavailable'};}
  const line=JSON.stringify(status);
  if(line!==lastOutput||Date.now()-lastOutputAt>=60000||args.includes('--once')){output(status);lastOutput=line;lastOutputAt=Date.now();}
  if(await stat(stopPath).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))stop=true;
  if(args.includes('--once')||stop)break;
  await new Promise(done=>{const t=setTimeout(done,config.pollMilliseconds);wake=()=>{clearTimeout(t);done();};});wake=undefined;
 }while(!stop);
 }
}catch(e){output({error:/^bridge_[a-z0-9_]{1,100}$/.test(e.code??'')?e.code:'bridge_configuration_or_lock_error'});process.exitCode=1;}
finally{await journal?.close();}
