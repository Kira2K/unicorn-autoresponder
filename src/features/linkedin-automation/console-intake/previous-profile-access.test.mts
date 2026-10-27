import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previousProfileAccess} from './previous-profile-access.mts';
import type {SqlSession} from '../../../integrations/postgres/contracts.mts';
const task={id:16,linkedinAccountId:1425,createdAt:'2026-10-27T10:00:00.000Z',status:'не начата'};
test('prior LinkedIn is resolved server-side and only profiles older than the current task are exposed',async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const sql:Pick<SqlSession,'query'>={async query(query,values=[]){calls.push({sql:query,values});return{rows:query.includes('AS had_linkedin')?[{had_linkedin:true}]:[{profile_id:'350'},{profile_id:'351'}]};}};
  assert.deepEqual(await previousProfileAccess(sql,270,task),{hadLinkedInBeforeTask:true,previousOctoProfileIds:[350,351]});
  assert.deepEqual(calls[0].values,[270,1425,16,task.createdAt]);
  assert.match(calls[0].sql,/a\.clients_id=\$1/);
  assert.match(calls[0].sql,/a\.id<>\$2/,'current expert draft alone cannot establish previous LinkedIn');
  assert.match(calls[1].sql,/client_id=\$1/);
  assert.match(calls[1].sql,/createdAt/);
  assert.deepEqual(calls[1].values,[270,Date.parse(task.createdAt)]);
  assert.ok(calls.every(c=>c.sql.trimStart().startsWith('SELECT')));
});
test('first-time registration and absent tasks expose no old-profile access',async()=>{
  let queries=0;
  const sql:Pick<SqlSession,'query'>={async query(){queries++;return{rows:[{had_linkedin:false}]};}};
  const empty={hadLinkedInBeforeTask:false,previousOctoProfileIds:[]};
  assert.deepEqual(await previousProfileAccess(sql,270,undefined),empty);assert.equal(queries,0);
  assert.deepEqual(await previousProfileAccess(sql,270,task),empty);assert.equal(queries,1);
});
