import { PGlite } from '@electric-sql/pglite';
import { COPY_MARKER } from '../../../integrations/postgres/contracts.mts';
import type { SqlPool } from '../../../integrations/postgres/contracts.mts';
import { planSchema, applySchema } from '../schema.mts';

export async function fixture(migrate = false) {
  const engine = new PGlite();
  const db = {
    exec:engine.exec.bind(engine),
    query:(sql:string,params?:unknown[])=>engine.query<Record<string,unknown>>(sql,params),
    close:()=>engine.close()
  };
  const definition = { id: 'mxza381054ldlza', title: 'clients', table_name: 'clients', sqlName: 'Student Records', sqlTable: 'noco.Student Records',
    columns: [{ id:'cclient', title:'Id', pk:true, uidt:'ID' }], mapping:[{id:'cclient',title:'Id',sqlName:'Record Id',sqlType:'bigint'}] };
  await db.exec(`CREATE SCHEMA noco; CREATE TABLE noco."Student Records"("Record Id" bigint PRIMARY KEY);
    INSERT INTO noco."Student Records" VALUES(1),(2); CREATE SCHEMA copy_meta; CREATE TABLE copy_meta.inventory(id text PRIMARY KEY,definition jsonb);`);
  await db.query('INSERT INTO copy_meta.inventory VALUES($1,$2)', ['clients',JSON.stringify(definition)]);
  const identity = { database:'unicorn_noco_copy_restore', marker:COPY_MARKER };
  const state = { db, identity, marker:COPY_MARKER, database:'unicorn_noco_copy_restore' as const, calls:[] as string[], failOn:'', failCommit:false, pool:undefined as unknown as SqlPool };
  state.pool = { async end(){}, async connect(){ return { release(){}, async query(sql, params){
    state.calls.push(sql);
    if (sql.includes('shobj_description')) return { rows:[{...identity}] };
    if (state.failOn && sql.includes(state.failOn)) throw Error('PRIVATE SQL FAILURE');
    if (params?.length) return db.query(sql, params) as any;
    const results = await db.exec(sql);
    if (sql === 'COMMIT' && state.failCommit) throw Error('PRIVATE CONNECTION FAILURE');
    return {rows:results.at(-1)?.rows ?? []} as any;
  }}; }};
  if(migrate){ const p=await planSchema(state.pool,state.database); await applySchema(state.pool,state.database,p.checksum); }
  return state;
}
