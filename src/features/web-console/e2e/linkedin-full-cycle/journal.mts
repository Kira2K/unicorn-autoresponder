import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';import {resolve} from 'node:path';import {randomUUID} from 'node:crypto';
import type {Evidence} from './contracts.mts';
export interface CycleJournal {runId:string;passed:boolean;createdAt:string;checks:Evidence[];clientId?:number;manualClientId?:number;completedCycles:number[];
 baseline?:{passwordHash:string;profiles:Array<[number,string]>;ruHash:string}}
export async function openCycleJournal(requested?:string){
 const root=resolve('tmp/linkedin-full-cycle');await mkdir(root,{recursive:true});
 let runId=requested;
 if(!runId)try{runId=String(JSON.parse(await readFile(resolve(root,'current.json'),'utf8')).runId);}catch{/* First invocation creates only a local journal. */}
 runId??=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14)+'-'+randomUUID().slice(0,8);
 if(!/^[a-z0-9-]{8,64}$/.test(runId))throw Error('e2e_invalid_run_id');
 const dir=resolve(root,runId);await mkdir(dir,{recursive:true});
 const file=resolve(dir,'report.json');let data:CycleJournal;
 try{data=JSON.parse(await readFile(file,'utf8'));if(data.runId!==runId)throw Error('e2e_journal_mismatch');}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;data={runId,passed:false,createdAt:new Date().toISOString(),checks:[],completedCycles:[]};}
 const save=async()=>{const tmp=file+'.next';await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,file);};
 await writeFile(resolve(root,'current.json'),JSON.stringify({runId}));
 return{dir,data,save,async record(check:Omit<Evidence,'at'>){data.checks.push({...check,at:new Date().toISOString()});await save();}};
}
export type RunJournal=Awaited<ReturnType<typeof openCycleJournal>>;
