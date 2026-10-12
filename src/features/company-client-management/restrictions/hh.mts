import type { PolicyRow } from './read.mts';
export function hhPolicy(rows:PolicyRow[]) {
  return (client:{Id:number},market:string) => {
    const rules=rows.filter(r=>(r.is_global||r.client_id===String(client.Id))&&(r.market==='all'||r.market===market.toLowerCase())&&(r.scope==='company'||r.hh_names.length>0));
    const unsupported=rules.filter(r=>r.include_subsidiaries);
    if(unsupported.length)return {companies:[],holdReason:'contextual_restriction_requires_review:'+unsupported.map(r=>r.id).join(',')};
    const names=new Map<string,{id:string;name:string}>();
    for(const r of rules)for(const name of r.scope==='company'?[r.company,...r.hh_names]:r.hh_names) {
      if(name)names.set(name,{id:'policy:'+r.id+':'+name,name});
    }
    return {companies:[...names.values()]};
  };
}
