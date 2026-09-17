import fs from 'node:fs/promises';
import path from 'node:path';
import type { Reader, Table } from './contracts.mts';
import { primaryKeys } from './contracts.mts';
import { canonical, digest } from './json.mts';
async function immutable(file:string,value:unknown):Promise<void>{
  const text=canonical(value);
  try{await fs.writeFile(file,text,{flag:'wx',mode:0o600});}
  catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    if((await fs.readFile(file,'utf8')).trim()!==text)throw new Error('metadata_resume_changed');
  }
}
export async function inspect(reader: Reader, baseId: string, directory: string): Promise<Table[]> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const response = await reader.get<{ list: Table[]; pageInfo?: { isLastPage?: boolean } }>(`/api/v2/meta/bases/${baseId}/tables`);
  if (!Array.isArray(response.list) || response.pageInfo?.isLastPage === false) throw new Error('incomplete_table_inventory');
  const tables: Table[] = [];
  const pending = [...response.list];
  const seen = new Set(pending.map(t => t.id));
  for (const item of pending) {
    const table = await reader.get<Table>(`/api/v2/meta/tables/${item.id}`);
    primaryKeys(table); tables.push(table);
    for (const column of table.columns) {
      for (const target of [column.colOptions?.fk_mm_model_id, column.colOptions?.fk_related_model_id]) {
        if (typeof target === 'string' && !seen.has(target)) { seen.add(target); pending.push({ id: target } as Table); }
      }
    }
    await immutable(path.join(directory, `${table.id}.json`), table);
  }
  await immutable(path.join(directory, 'tables.json'), tables);
  await fs.writeFile(path.join(directory, 'inventory.json'), canonical({ baseId, capturedAt: new Date().toISOString(),
    hash: digest(tables), count: tables.length }), { flag: 'wx', mode: 0o600 });
  return tables;
}
