import fs from 'node:fs/promises'; import path from 'node:path';
import type { Snapshot } from './snapshot.mts'; import { guard } from './sql-schema.mts';
import { load, save } from './files.mts'; import { canonical } from './json.mts'; import { literal } from './sql-values.mts';
export async function prepareDescriptions(snapshot:Snapshot,directory:string,output:string):Promise<void>{
  // Base view definitions are returned within table metadata, not GET /meta/views/:id.
  for(const table of snapshot.tables){
    for(const view of (table as typeof table & {views?:{id:string}[]}).views??[]){
      const file=path.join(directory,'view_'+view.id+'.json');
      try{await fs.access(file);}catch{await save(file,view);}
    }
  }
  const stream=await fs.open(output,'wx',0o600);
  try{
    await stream.write(guard+'BEGIN;\n');
    for(const file of (await fs.readdir(directory)).filter(f=>f.endsWith('.json'))){
      await stream.write(`INSERT INTO copy_meta.inventory VALUES (${literal('description:'+file)},${literal(canonical(await load(path.join(directory,file))))}::jsonb)
        ON CONFLICT (id) DO UPDATE SET definition=EXCLUDED.definition;\n`);
    }
    for(const [id,unavailable] of snapshot.unavailable){
      await stream.write(`INSERT INTO copy_meta.inventory VALUES (${literal('coverage:'+id)},${literal(canonical({unavailable:[...unavailable]}))}::jsonb)
        ON CONFLICT (id) DO UPDATE SET definition=EXCLUDED.definition;\n`);
    }
    await stream.write(`INSERT INTO copy_meta.inventory VALUES ('source_issues',${literal(canonical(snapshot.sourceIssues))}::jsonb)
      ON CONFLICT (id) DO UPDATE SET definition=EXCLUDED.definition;\nCOMMIT;\n`);
  }finally{await stream.close();}
}
