import {open,readFile,rename,unlink,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {State,Store} from './types.mts';
import {assertStateMutation} from './state-contract.mts';
import {emptyState} from './types.mts';

/** Local test persistence: exclusive file lock, atomic replace, and publish only after persistence. */
export async function openFileStore(file:string,binding:string,initial:State):Promise<Store&{fresh:boolean;close():Promise<void>}>{
  await mkdir(dirname(file),{recursive:true});
  let lock;
  try{lock=await open(file+'.lock','wx');}catch(error){
    if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('mentor_test_state_locked');
    throw error;
  }
  let data:State,fresh=false,closed=false,tail=Promise.resolve();
  async function persist(state:State){
    const temp=file+'.'+randomUUID()+'.tmp';
    try{
      const handle=await open(temp,'wx');
      try{await handle.writeFile(JSON.stringify({version:1,binding,state}));await handle.sync();}finally{await handle.close();}
      await rename(temp,file);
    }finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  try{
    await lock.writeFile(JSON.stringify({pid:process.pid}));
    try{
      const saved=JSON.parse(await readFile(file,'utf8'));
      if(saved.version!==1||saved.binding!==binding)throw new Error('mentor_test_state_binding_mismatch');
      data=saved.state;
      if(!data||!Number.isSafeInteger(data.offset)||data.offset<0||
        !['clients','learners','sessions','checkins','deliveries','operations','history'].every(key=>
          data[key as keyof State]&&typeof data[key as keyof State]==='object')||!Array.isArray(data.sourceEvents))
        throw new Error('mentor_test_state_invalid');
      assertStateMutation(emptyState(),data);
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      data=structuredClone(initial);assertStateMutation(emptyState(),data);fresh=true;await persist(data);
    }
  }catch(error){await lock.close();await unlink(file+'.lock');throw error;}
  return {fresh,
    async transaction<T>(operation:(s:State)=>T):Promise<T>{
      if(closed)throw new Error('mentor_test_state_closed');
      const previous=tail;let release!:()=>void;tail=new Promise<void>(resolve=>{release=resolve;});
      await previous;
      try{
        const draft=structuredClone(data),result=operation(draft);
        if(result&&typeof (result as {then?:unknown}).then==='function')throw new Error('mentor_async_transaction_forbidden');
        assertStateMutation(data,draft);
        const answer=structuredClone(result);
        if(JSON.stringify(draft)!==JSON.stringify(data))await persist(draft);
        data=draft;return answer;
      }finally{release();}
    },
    async close(){if(closed)return;closed=true;await tail;await lock.close();await unlink(file+'.lock');}
  };
}
