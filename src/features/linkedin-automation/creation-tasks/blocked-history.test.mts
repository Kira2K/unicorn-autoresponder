import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SqlSession } from '../../../integrations/postgres/contracts.mts';
import { loadBlockedHistory } from './blocked-history.mts';

test('latest request combines entered history with all archived LinkedIn accounts and deduplicates copied history', async () => {
  const entered = {fullName:'Earlier Name',country:'Poland',company:'Example'};
  const rows = [
    {id:11,linkedin_first_name:'Alex',linkedin_last_name:'Smith',real_location:'Tbilisi',
      url:'https://linkedin.com/in/old-one',login:'old@example.test',password:'never-return-this-secret',old_link_blocked:JSON.stringify([entered])},
    {id:21,linkedin_first_name:'Alex',linkedin_last_name:'Jones',url:'https://linkedin.com/in/old-two',
      old_link_blocked:JSON.stringify([{company:'Another employer'}, {company:'Example',country:'Poland',fullName:'Earlier Name'}])},
  ];
  const calls:{sql:string;values:unknown[]}[]=[];
  const sql:Pick<SqlSession,'query'>={async query(query,values=[]){calls.push({sql:query,values});return{rows};}};
  const result=await loadBlockedHistory(sql,7,31,JSON.stringify([entered]));
  assert.equal(result.length,4);
  assert.deepEqual(result[0],entered);
  assert.equal(result[1].fullName,'Alex Smith');
  assert.match(result[1].legacyText!,/https:\/\/linkedin.com\/in\/old-one/);
  assert.match(result[1].legacyText!,/old@example.test/);
  assert.match(result[1].legacyText!,/Tbilisi/);
  assert.deepEqual(result[2],{company:'Another employer'});
  assert.equal(result[3].fullName,'Alex Jones');
  assert.deepEqual(calls[0].values,[7,31]);
  assert.match(calls[0].sql,/a\.clients_id=\$1/);
  assert.match(calls[0].sql,/a\.id<>\$2/);
  assert.match(calls[0].sql,/coalesce\(a\.__nc_deleted,false\)/i);
  assert.match(calls[0].sql,/lower\(p\.name\)='linkedin'/);
  assert.ok(!JSON.stringify(result).includes('never-return-this-secret'));
  assert.match(calls[0].sql,/AS has_password/);
  assert.ok(calls.every(call=>call.sql.trimStart().startsWith('SELECT')),'reading history never persists or migrates records');
});

test('legacy notes survive; incomplete archived preparations do not become extra blocked accounts', async () => {
  const sql:Pick<SqlSession,'query'>={async query(){return{rows:[
    {id:1,linkedin_first_name:'Never registered',old_link_blocked:'Legacy note'},
    {id:2,has_password:true,old_link_blocked:''},
    {id:3,url:'https://linkedin.com/in/old',old_link_blocked:'Legacy note'},
    {id:4,url:'https://linkedin.com/in/old',old_link_blocked:''},
  ]};}};
  const history=await loadBlockedHistory(sql,7,10,'Legacy note');
  assert.equal(history.length,4);
  assert.equal(history[0].fullName,'Legacy note');
  assert.match(history[1].legacyText!,/2/,'an archived credential-only account stays visible without returning its password');
  assert.equal(history.filter(item=>item.legacyText?.includes('https://linkedin.com/in/old')).length,2,
    'distinct archived row IDs are not collapsed merely because their saved data matches');
});
