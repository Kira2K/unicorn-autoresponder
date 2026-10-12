import test from 'node:test';
import assert from 'node:assert/strict';
import { captureLegacySnapshot,inspectSnapshot,sourceTables } from '../legacy-snapshot.mts';
import type { LegacyReader } from '../legacy-snapshot.mts';
import { parseCommand } from '../cli.mts';

test('CLI writes require explicit mode and reviewed checksum; import defaults to offline dry-run',()=>{
  assert.equal(parseCommand(['import-legacy','--input','snapshot.json']).values.apply,undefined);
  assert.throws(()=>parseCommand(['apply']),/reviewed_checksum_required/);
  assert.throws(()=>parseCommand(['import-legacy','--input','snapshot.json','--apply']),/reviewed_checksum_required/);
  assert.throws(()=>parseCommand(['plan','--apply']),/invalid_mode/);
  assert.throws(()=>parseCommand(['import-legacy','--input','snapshot.json','--apply','--dry-run']),/invalid_mode/);
  assert.equal(parseCommand(['apply','--expect-checksum','a'.repeat(64)]).command,'apply');
});

test('capture follows source pagination and native links, retaining text-only restrictions for review',async()=>{
  const calls:string[]=[];
  const tables=Object.values(sourceTables).map(id=>({id,columns:[]}));
  tables.find(t=>t.id===sourceTables.restriction)!.columns=[{id:'rc',title:'rel_restrictions_client',colOptions:{fk_related_model_id:sourceTables.student_stop_list}},{id:'rb',title:'rel_restrictions_blocked_companies',colOptions:{fk_related_model_id:sourceTables.company}}] as any;
  const record=(key:string,data:Record<string,unknown>)=>({key:[key],data,sourceJson:JSON.stringify(data)});
  const reader={listTables:()=>tables,async listRecords(id:string,options:any){
    calls.push(id+':'+(options.after?.[0]??'first'));
    if(id===sourceTables.company)return options.after?{records:[record('11',{company_name:'A'})],nextKey:null}:{records:[record('10',{company_name:'A'})],nextKey:['10']};
    if(id===sourceTables.restriction)return {records:[record('20',{market:'en',offer_companies:'A'})],nextKey:null};
    if(id===sourceTables.student_stop_list)return {records:[record('1',{stop_list_company:'A',email:'PRIVATE'})],nextKey:null};
    return {records:[],nextKey:null};
  },async listRelated(_id:string,field:string){return {records:[record(field==='rc'?'1':'10',{})],nextKey:null};}} as unknown as LegacyReader;
  const s=await captureLegacySnapshot(reader);
  assert.equal(s.records.filter(r=>r.kind==='company').length,2);
  assert.ok(calls.includes(sourceTables.company+':10'));
  assert.deepEqual(s.records.find(r=>r.kind==='restriction')?.companyKeys,['10']);
  assert.deepEqual(s.records.find(r=>r.kind==='student_stop_list')?.values,{stop_list_company:'A'});
  assert.ok(!JSON.stringify(s).includes('PRIVATE'));
  const checksum=inspectSnapshot(s).checksum;
  assert.equal(checksum,inspectSnapshot(JSON.parse(JSON.stringify(s))).checksum);
  s.records.push(s.records[0]);assert.throws(()=>inspectSnapshot(s),/duplicate_legacy_source/);
});

test('missing relation does not infer client or company from raw names; source failures abort capture',async()=>{
  const reader={listTables:()=>Object.values(sourceTables).map(id=>({id,columns:[]})),async listRecords(id:string){
    return {records:id===sourceTables.restriction?[{key:['1'],data:{raw_client_name:'Student',offer_companies:'Company'},sourceJson:'{}'}]:[],nextKey:null};
  },async listRelated(){throw Error('should not infer links');}} as unknown as LegacyReader;
  const result=await captureLegacySnapshot(reader);
  assert.deepEqual(result.records[0].clientKeys,[]);assert.equal(result.records[0].issues.length,2);
  reader.listRecords=async()=>{throw Error('source unavailable');};
  await assert.rejects(captureLegacySnapshot(reader),/source unavailable/);
});
