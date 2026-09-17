import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { exportTable } from './export-table.mts'; import { rows } from './files.mts';
import { schemaHash } from './export.mts'; import type { Reader, Table } from './contracts.mts';
import { resumePacing } from './pacing.mts';
const table: Table={id:'mtest',table_name:'test',title:'Test',columns:[{id:'cid',column_name:'id',title:'Id',uidt:'ID',pk:true}]};
test('interrupted export restarts incomplete table without duplicating records; completed checkpoint is verified',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'noco-copy-test-')); let calls=0, interrupt=true;
  const reader: Reader={async get<T>(_p:string,q:Record<string,string>={}):Promise<T>{calls++;
    if(q.offset==='2'&&interrupt)throw new Error('disconnected');
    return {list:q.offset==='0'?[{Id:1},{Id:2}]:[{Id:3}],pageInfo:{isLastPage:q.offset==='2',totalRows:3}} as T;
  }};
  try {
    await assert.rejects(exportTable(reader,table,directory),/disconnected/); interrupt=false;
    const result=await exportTable(reader,table,directory); const actual=[];
    for await(const row of rows(path.join(directory,result.file)))actual.push(row);
    assert.deepEqual(actual,[{Id:1},{Id:2},{Id:3}]); const before=calls;
    await exportTable(reader,table,directory); assert.equal(calls,before);
    await fs.appendFile(path.join(directory,result.file),'{}\n');
    await assert.rejects(exportTable(reader,table,directory),/checksum/);
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});
test('structural changes cannot reuse old mapping',()=>{
  assert.notEqual(schemaHash([table]),schemaHash([{...table,columns:[...table.columns,{id:'new',title:'New',column_name:'new',uidt:'LongText'}]}]));
});
test('a new command pauses and retains the entire persisted cooldown',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'noco-pacing-test-'));let time=0;
  const timing={now:()=>time,sleep:async(ms:number)=>{time+=ms;}};
  try {const file=path.join(directory,'cooldown.json');const log=await resumePacing(file,timing);
    assert.equal(time,1000);log({event:'cooldown_started',waitMs:91000});time+=500;
    await resumePacing(file,timing);assert.equal(time,92000);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
