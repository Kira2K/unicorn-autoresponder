import path from 'node:path';
import type { Reader, Row, Page } from './contracts.mts';
import { primaryKeys } from './contracts.mts';
import type { Snapshot } from './snapshot.mts';
import { readPages } from './pages.mts';
import { rowKey } from './relations.mts';
import { save } from './files.mts';
export async function auditLinks(reader: Reader, snapshot: Snapshot): Promise<void> {
  const report: {field:string;links:number;status:string}[]=[];
  for(const table of snapshot.tables) {
    if(primaryKeys(table).length!==1)continue;
    for(const field of table.columns.filter(c=>['Links','LinkToAnotherRecord'].includes(c.uidt))) {
      const target=snapshot.tables.find(t=>t.id===field.colOptions?.fk_related_model_id)!;
      if(primaryKeys(target).length!==1)continue;
      const groups=new Map<string,Set<string>>();
      for(const e of snapshot.edges.filter(e=>e.field===field.id)) {
        if(!groups.has(e.source))groups.set(e.source,new Set()); groups.get(e.source)!.add(e.target);
      }
      const largest=[...groups].sort((a,b)=>b[1].size-a[1].size)[0];
      if(!largest)continue;
      const [source,expected]=largest, id=JSON.parse(source)[0] as string;
      const actual=new Set<string>();
      const endpoint=`/api/v2/tables/${table.id}/links/${field.id}/records/${encodeURIComponent(id)}`;
      const keys=primaryKeys(target).map(c=>c.title);
      const first=await reader.get<Page & Row>(endpoint,{limit:'100',offset:'0',sort:keys.join(',')});
      if(['bt','mo'].includes(String(field.colOptions?.type)) && first && keys.every(k=>k in first)) {
        actual.add(rowKey(target,first));
      } else {
        const paged:Reader={get:async<T,>(p:string,q:Record<string,string>={})=> q.offset==='0'?first as T:reader.get<T>(p,q)};
        // Link API may order by relationship position, ignoring sort. Compare the complete ID set.
        for await(const page of readPages(paged,endpoint,keys,{},false))for(const row of page)actual.add(rowKey(target,row));
      }
      if(actual.size!==expected.size||[...expected].some(key=>!actual.has(key)))throw new Error(`link_api_mismatch:${field.id}`);
      report.push({field:field.id,links:actual.size,status:'matched'});
    }
  }
  await save(path.join(snapshot.directory,'link-api-audit.json'),report);
  console.log(JSON.stringify({linkFieldsAudited:report.length,matchedLinks:report.reduce((n,r)=>n+r.links,0)}));
}
