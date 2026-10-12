import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mts';
import { planSchema,applySchema } from '../schema.mts';
import { inspectMigrationPermissions } from '../migration-permissions.mts';
import type { SqlSession } from '../../../integrations/postgres/contracts.mts';

test('permission preflight accepts column REFERENCES and keeps identifiers parameterized',async()=>{
  const calls:{sql:string;values:unknown[]|undefined}[]=[];
  const session={release(){},async query(sql:string,values?:unknown[]){
    calls.push({sql,values});
    return {rows:[{create_schema:true,use_client_schema:true,reference_client_key:true}]};
  }} satisfies SqlSession;
  assert.deepEqual(await inspectMigrationPermissions(session,'noco."Student Records"','Record Id'),{allowed:true,missingPrivileges:[]});
  assert.deepEqual(calls[0].values,['noco."Student Records"','Record Id']);
  assert.ok(calls[0].sql.includes('has_column_privilege'));
  assert.ok(!calls[0].sql.includes('Student Records'));
});

test('permission preflight lists missing privileges and fails closed if metadata is unavailable',async()=>{
  const session={release(){},async query(){return {rows:[{create_schema:false,use_client_schema:true,reference_client_key:false}]};}};
  assert.deepEqual(await inspectMigrationPermissions(session,'noco.clients','id'),{
    allowed:false,missingPrivileges:['CREATE on database','REFERENCES on student primary key']
  });
  const empty={release(){},async query(){return {rows:[]};}};
  assert.deepEqual((await inspectMigrationPermissions(empty,'noco.clients','id')).missingPrivileges,
    ['CREATE on database','USAGE on student schema','REFERENCES on student primary key']);
});

test('restricted role can render a plan, but apply stops before DDL; receipt reconciliation needs no CREATE',async()=>{
  const f=await fixture();
  try {
    const originalConnect=f.pool.connect;
    let deny=false;
    f.pool.connect=async()=>{
      const session=await originalConnect();
      return {...session,async query(sql,values){
        if(deny && sql.includes('has_database_privilege'))
          return {rows:[{create_schema:false,use_client_schema:true,reference_client_key:false}]};
        return session.query(sql,values);
      }};
    };
    const permitted=await planSchema(f.pool,f.database);
    assert.equal(permitted.database,f.database);
    assert.equal(permitted.deployment.allowed,true);
    deny=true;
    const restricted=await planSchema(f.pool,f.database);
    assert.equal(restricted.checksum,permitted.checksum);
    assert.equal(restricted.status,'pending');
    assert.equal(restricted.deployment.allowed,false);
    await assert.rejects(applySchema(f.pool,f.database,restricted.checksum),/company_schema_permission_denied/);
    assert.equal((await f.db.query("SELECT to_regnamespace('company_management') AS schema")).rows[0].schema,null);
    assert.ok(!f.calls.some(sql=>sql.includes('CREATE SCHEMA company_management')));
    deny=false;
    await applySchema(f.pool,f.database,permitted.checksum);
    deny=true;
    assert.equal((await applySchema(f.pool,f.database,permitted.checksum)).status,'already_applied');
  } finally {await f.db.close();}
});
