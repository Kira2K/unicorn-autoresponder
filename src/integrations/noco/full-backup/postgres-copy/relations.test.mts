import test from 'node:test'; import assert from 'node:assert/strict';
import type { Table, Row } from './contracts.mts'; import { buildRelations } from './relations.mts';
const parent: Table={id:'a',title:'A',table_name:'a',columns:[{id:'pk_a',title:'Id',column_name:'id',uidt:'ID',pk:true},
  {id:'rel',title:'children',column_name:null,uidt:'Links',colOptions:{type:'hm',fk_related_model_id:'b',fk_child_column_id:'fk_b',fk_parent_column_id:'pk_a'}}]};
const child: Table={id:'b',title:'B',table_name:'b',columns:[{id:'pk_b',title:'Id',column_name:'id',uidt:'ID',pk:true},
  {id:'fk_b',title:'parent',column_name:'parent',uidt:'ForeignKey'}]};
test('large linked collections use complete foreign keys, not truncated embedded records',()=>{
  const children=Array.from({length:1001},(_,i)=>({Id:i+1,parent:1}));
  const data=new Map<string,Row[]>([['a',[{Id:1,children:1001}]],['b',children]]);
  assert.equal(buildRelations([parent,child],data).length,1001);
  data.set('b',children.slice(0,100)); assert.throws(()=>buildRelations([parent,child],data),/relation_count_changed/);
});
