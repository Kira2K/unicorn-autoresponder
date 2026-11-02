import {test} from 'node:test';import assert from 'node:assert/strict';
import {workflowFixture} from './workflow-fixture.mts';
import {createSqlConsoleRepository} from './repository.mts';
import {consoleRecords} from './records.mts';
import {tableIds} from './tables.mts';
test('backend account DTO exposes the current LinkedIn-only flag without making it a student input',async()=>{
 const f=workflowFixture();let flag=true;const reads:number[][]=[];
 const readFlags=async(ids:number[])=>{reads.push(ids);return[{id:21,isUnsyncedWithCRM:flag}];};
 const repo=createSqlConsoleRepository(f.db,{...f.grant,readLinkedInCrmFlags:readFlags});
 const first=await repo.getClientDashboard(7);
 assert.equal(first.platformAccounts.find(a=>a.id===21)!.isUnsyncedWithCRM,true);
 assert.ok(first.platformAccounts.filter(a=>a.id!==21).every(a=>!Object.hasOwn(a,'isUnsyncedWithCRM')));
 flag=false;assert.equal((await repo.getClientDashboard(7)).platformAccounts.find(a=>a.id===21)!.isUnsyncedWithCRM,false);
 const before=structuredClone(f.rows.get(tableIds.accounts)!.get('21'));
 await assert.rejects(repo.updatePlatformAccount(7,21,{isUnsyncedWithCRM:true}as never));
 assert.deepEqual(f.rows.get(tableIds.accounts)!.get('21'),before);
 const count=reads.length;await consoleRecords(f.db,readFlags).fetchRecords(tableIds.clients,100,{fields:'Id'});assert.equal(reads.length,count);
 await consoleRecords(f.db,readFlags).fetchRecords(tableIds.accounts,100,{where:'(Id,eq,21)',fields:'Id,isUnsyncedWithCRM'});assert.deepEqual(reads.at(-1),[21]);
});
