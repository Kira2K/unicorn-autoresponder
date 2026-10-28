import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseCycleArgs,fixtureNames,fixtureEmail,fixtureMarker,assertFixture} from './contracts.mts';
import {profileRules} from '../../../octo-access/profile-reservation.mts';
test('live is opt-in and run IDs cannot escape private evidence storage',()=>{
 assert.deepEqual(parseCycleArgs([]),{apply:false,runId:undefined});assert.equal(parseCycleArgs(['--apply']).apply,true);
 for(const args of [['--apply','--preflight'],['--run-id','../../secret'],['--unknown'],['--apply','--apply']])assert.throws(()=>parseCycleArgs(args));
});
test('only the exact marked Cyrillic fixture is reusable; an email collision is never adopted',()=>{
 const run='20261028-test',kind='auto',n=fixtureNames[kind];
 const row={legend_info:fixtureMarker(run,kind),calendar_email:fixtureEmail(run,kind),first_name:n.first,last_name:n.last,client_status:'paused',client_role:'фейк'};
 assert.doesNotThrow(()=>assertFixture(row,run,kind));
 for(const change of [{legend_info:'other'},{first_name:'Pavel'},{client_status:'active'},{client_role:'ученик'}])assert.throws(()=>assertFixture({...row,...change},run,kind));
 assert.ok(/^[А-Яа-яЁё]+$/.test(fixtureNames.manual.first+fixtureNames.manual.last));
});
test('the pristine manual fixture uses Cyrillic profile names without creating profiles',()=>{
 const n=fixtureNames.manual;
 for(const locale of ['en','ru'] as const){
  const title=profileRules.buildProfileName({firstName:n.first,lastName:n.last,clientName:`${n.first} ${n.last}`,primaryStack:'JAVA'} as any,locale);
  assert.ok(title.startsWith('Илья Проверкин'));assert.ok(title.includes('JAVA'));
 }
});
