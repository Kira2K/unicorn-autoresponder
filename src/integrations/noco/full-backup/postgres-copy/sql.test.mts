import test from 'node:test'; import assert from 'node:assert/strict';
import { confirmedAbsent } from './reconcile.mts';
import { literal, sqlValue } from './sql-values.mts';
import { parse } from './json.mts';
import { guard } from './sql-schema.mts';
import { compareSnapshots } from './reconcile.mts';
import type { Snapshot } from './snapshot.mts';
import { prepareSql } from './prepare.mts';
test('deletion needs two complete observations; replay does not add evidence', () => {
  assert.deepEqual(confirmedAbsent([new Set(['1','2'])],new Set(['1'])),[]);
  assert.deepEqual(confirmedAbsent([new Set(['1','2']),new Set(['1'])],new Set(['1'])),['2']);
  assert.deepEqual(confirmedAbsent([new Set(['1','2']),new Set(['1'])],new Set(['1','2'])),[]);
});
test('SQL preserves exact numeric literals, null, empty, unicode and escaping', () => {
  assert.equal(sqlValue(parse('9007199254740993'),'numeric'),"'9007199254740993'::numeric");
  assert.equal(sqlValue('', 'text'),"''::text"); assert.equal(sqlValue(null,'text'),'NULL::text');
  assert.equal(literal("x'; SELECT 1;--"),"'x''; SELECT 1;--'");
  assert.equal(sqlValue('Диана','text'),"'Диана'::text");
  assert.throws(()=>literal('\0')); assert.throws(()=>sqlValue({},'text'));
});
test('import rejects an unowned database including a missing marker',()=>{
  assert.match(guard,/IS DISTINCT FROM/); assert.match(guard,/shobj_description/);
  assert.match(guard,/SET ROLE unicorn_noco_copy_owner/);
});
test('equal counts do not hide changed values or substituted IDs',()=>{
  const initial:Snapshot={directory:'',manifest:{version:1,baseId:'test',startedAt:'',schemaHash:'s',tables:[],links:0,attachments:0},
    tables:[{id:'t',table_name:'t',title:'T',columns:[{id:'c',title:'Id',column_name:'id',uidt:'ID',pk:true}]}],
    data:new Map([['t',[{Id:1,value:'old'}]]]),edges:[],sourceIssues:[],unavailable:new Map()};
  const changed={...initial,data:new Map([['t',[{Id:1,value:'new'}]]])};
  assert.equal(compareSnapshots(initial,changed).rows.length,1);
  assert.equal(compareSnapshots(initial,{...changed,data:new Map([['t',[{Id:2,value:'old'}]]])}).rows.length,2);
});
test('replaying one snapshot cannot establish two observations for deletion',async()=>{
  const s:Snapshot={directory:'same',manifest:{version:1,baseId:'test',startedAt:'start',completedAt:'end',schemaHash:'s',tables:[],links:0,attachments:0},
    tables:[],data:new Map(),edges:[],sourceIssues:[],unavailable:new Map()};
  await assert.rejects(prepareSql(s,'unused',[s]),/repeated_observation_not_evidence/);
});
