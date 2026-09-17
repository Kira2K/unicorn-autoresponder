import path from 'node:path'; import fs from 'node:fs/promises';
import type { Reader, Table } from './contracts.mts'; import { save } from './files.mts';
interface View { id: string; type: number; }
export async function exportDescriptions(reader: Reader, tables: Table[], directory: string): Promise<void> {
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const results: {file:string;status:number}[]=[];
  const request = async (file:string,endpoint:string) => {
    try { const data=await reader.get(endpoint); await save(path.join(directory,file+'.json'),data); results.push({file,status:200}); }
    catch(error) {
      const status=(error as {response?:{status?:number}}).response?.status;
      if(!status||![401,403,404,422].includes(status))throw error;
      results.push({file,status});
    }
  };
  for(const table of tables) {
    await request('hooks_'+table.id,`/api/v2/meta/tables/${table.id}/hooks`);
    const views=(table as Table & {views?:View[]}).views??[];
    for(const view of views) {
      await save(path.join(directory,'view_'+view.id+'.json'),view);
      results.push({file:'view_'+view.id,status:200});
      for(const section of ['columns','filters','sorts'])
        await request(`${section}_${view.id}`,`/api/v2/meta/views/${view.id}/${section}`);
    }
  }
  await save(path.join(directory,'index.json'),results);
  console.log(JSON.stringify({metadataRequests:results.length,available:results.filter(r=>r.status===200).length,
    unavailable:results.filter(r=>r.status!==200).length}));
}
