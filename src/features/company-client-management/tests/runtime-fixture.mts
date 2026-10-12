import { fixture } from './fixture.mts';
import { seedLegacy } from './legacy-fixture.mts';
import { exportLegacySnapshot } from '../legacy-export.mts';
import { importLegacySnapshot } from '../legacy-import.mts';
import { inspectSnapshot } from '../legacy-snapshot.mts';
import { planDirectory,applyDirectory } from '../directory/import.mts';
import { planBusinessRelocation,applyBusinessRelocation } from '../relocation/index.mts';
import { planRuntime,applyRuntime } from '../runtime-migration/index.mts';
import { planWorkflowRelocation,applyWorkflowRelocation } from '../workflow-relocation/index.mts';
import { createRequire } from 'node:module';
const {TABLES}=createRequire(import.meta.url)('../../../integrations/noco/core/schema.ts');
export async function runtimeFixture(migrate=true) {
  const f=await fixture(true);await seedLegacy(f);
  const snapshot=await exportLegacySnapshot(f.pool,f.database);
  await importLegacySnapshot(f.pool,f.database,snapshot,inspectSnapshot(snapshot).checksum);
  const input={version:1 as const,source:{fileId:'fixture',capturedAt:'2026-09-26T00:00:00Z',workbookSha256:'b'.repeat(64)},companies:[
    {key:'new',name:'Current',comment:'',markets:['Global'],tags:[],languages:[],aliases:[],contacts:[],applicationRoute:'standard_workflow' as const,provenance:{row:2}}
  ],sources:[{key:'new-source',companyKey:'new',name:'Current',type:'website' as const,url:'https://example.test/jobs',disposition:'enabled' as const,comment:'',provenance:{row:2}}]};
  const directory=await planDirectory(f.pool,f.database,input);await applyDirectory(f.pool,f.database,input,directory.checksum);
  await f.db.exec('CREATE ROLE test_noco_runtime; CREATE TABLE noco.stacks(id bigint PRIMARY KEY); INSERT INTO noco.stacks VALUES(5);');
  const col={id:'stack_pk',title:'Id',pk:true,uidt:'ID',sqlName:'id',sqlType:'bigint'};
  await f.db.query('INSERT INTO copy_meta.inventory VALUES($1,$2)',[TABLES.stacks.id,JSON.stringify({id:TABLES.stacks.id,title:'stacks',table_name:'stacks',sqlName:'stacks',sqlTable:'noco.stacks',columns:[col],mapping:[col]})]);
  const relocation=await planBusinessRelocation(f.pool,f.database,'test_noco_runtime');await applyBusinessRelocation(f.pool,f.database,'test_noco_runtime',relocation.checksum);
  if(migrate){const plan=await planRuntime(f.pool,f.database);await applyRuntime(f.pool,f.database,plan.checksum);}
  return f;
}

/** Current table placement for feature adapter tests; historical migration tests keep the old fixture. */
export async function workflowFixture() {
  const f=await runtimeFixture();
  try {
    const plan=await planWorkflowRelocation(f.pool,f.database);
    await applyWorkflowRelocation(f.pool,f.database,plan.checksum);
    return f;
  }catch(error){await f.db.close();throw error;}
}
