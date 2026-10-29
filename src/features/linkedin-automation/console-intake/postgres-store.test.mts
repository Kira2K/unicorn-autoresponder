import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPY_MARKER } from '../../../integrations/postgres/contracts.mts';
import type { SqlPool } from '../../../integrations/postgres/contracts.mts';
import { createLinkedInIntakeStore } from './postgres-store.mts';
import { parseIntake } from './contracts.mts';
import { tableIds } from '../../web-console/backend/postgres/tables.mts';
const input = () => parseIntake({ scenario: 'new', outlookLogin: 'alex@outlook.com', outlookPassword: 'mail-secret',
  firstName: 'Alex', lastName: 'Smith', realLocation: 'Tbilisi', blockedAccounts: [{ fullName: 'Old Alex' }, { country: 'UK' }] });
function fixture(creationTasks = false,afterBan?:(clientId:number,accountId:number)=>Promise<unknown>) {
  const state: { accounts: Record<string, unknown>[]; client?: Record<string, unknown>; profiles: Record<string, unknown>[]; tasks: Record<string,unknown>[] } = { accounts: [], profiles: [], tasks: [], client: undefined };
  const control = { failQueue: false, failTask: false, uncertain: false }, calls: string[] = [];
  let backup = structuredClone(state);
  let nextId = 1, banRevision = 0;
  const pool: SqlPool = { async end() {}, async connect() { return { release() {}, async query(sql, values = []) {
    calls.push(sql);
    if (sql.includes('current_database()')) return { rows: [{ database: 'unicorn_noco_copy_restore', marker: COPY_MARKER }] };
    if (sql.includes('copy_meta.inventory')) return { rows: [{ definition: { id: tableIds.accounts,
      title: 'platform_accounts', table_name: 'platform_accounts', sqlTable: 'noco.platform_accounts',
      columns: [{ id: 'account_pk', title: 'Id', pk: true }],
      mapping: [{ id: 'account_pk', title: 'Id', sqlName: 'id', sqlType: 'bigint' }] } }] };
    if (sql.includes('SELECT nextval')) return { rows: [{ id: String(nextId++) }] };
    if (sql.startsWith('BEGIN')) { backup = structuredClone(state); return { rows: [] }; }
    if (sql === 'ROLLBACK') { Object.assign(state, structuredClone(backup)); return { rows: [] }; }
    if (sql === 'COMMIT') {
      backup = structuredClone(state);
      if (control.uncertain) { control.uncertain = false; throw Error('ack lost'); }
      return { rows: [] };
    }
    if(sql.includes('AS had_linkedin'))return{rows:[{had_linkedin:state.accounts.some(a=>a.clients_id===values[0]&&Number(a.id)!==Number(values[1])&&a.platform==='linkedin'&&(a.url||a.login||a.password)) || state.tasks.some(t=>t.client_id===values[0]&&Number(t.id)!==Number(values[2])&&t.status==='выполнение подтверждено'&&new Date(String(t.created_at)).getTime()<Date.parse(String(values[3])))}]};
    if(sql.startsWith('SELECT profile_id FROM noco.octo_profiles'))return{rows:state.profiles.filter(p=>Number((p.state as any).createdAt)<=Number(values[1])&&!(p.state as any).deletion)};
    if (sql.includes('FROM noco.linkedin_creation_task')) return { rows: state.tasks.filter(t=>Number(t.client_id)===Number(values[0]) &&
      (!sql.includes("source='student_intake'") || t.source==='student_intake') &&
      (!values[1] || Number(t.linkedin_account_id)===Number(values[1]) || Number(t.outlook_account_id)===Number(values[1]))) };
    if (sql.startsWith('UPDATE noco.linkedin_creation_task SET source=')) {
      for(const row of state.tasks)if(row.client_id===values[0]&&row.linkedin_account_id===values[1]&&row.source==='student_intake')row.source='manual';
      return{rows:[]};
    }
    if(sql.startsWith('UPDATE noco.linkedin_creation_task SET')){
      const row=state.tasks.find(t=>Number(t.id)===Number(values[0])&&t.client_id===values[1]&&t.linkedin_account_id===values[2]&&t.outlook_account_id===values[3]);
      if(!row)return{rows:[]};
      row.version=Number(row.version)+1;
      if(values[4]){delete row.proxy_uuid;delete row.proxy_saved_at;delete row.proxy_profile_id;}
      return{rows:[{...row,created:false}]};
    }
    if (sql.startsWith('INSERT INTO noco.linkedin_creation_task')) {
      if(control.failTask) throw Error('task failed');
      let row=state.tasks.find(t=>t.client_id===values[0]&&t.source==='student_intake');
      const created=!row;
      if(!row) { row={id:state.tasks.length+1,client_id:values[0],linkedin_account_id:values[1],outlook_account_id:values[2],source:'student_intake',status:'не начата',version:1,created_at:new Date(),updated_at:new Date()}; state.tasks.push(row); }
      else row.version=Number(row.version)+1;
      if(values[3]) {delete row.proxy_uuid;delete row.proxy_saved_at;delete row.proxy_profile_id;}
      return {rows:[{...row,created}]};
    }
    if (sql.includes('FROM noco.clients')) return { rows: [{ id: values[0] }] };
    if (sql.includes('FROM noco.platform_accounts a JOIN')) return { rows: structuredClone(state.accounts.filter(row=>Number(row.clients_id)===Number(values[0])&&
      (sql.includes('AND coalesce(a.__nc_deleted,false)')?row.__nc_deleted&&row.platform==='linkedin'&&Number(row.id)!==Number(values[1]):!row.__nc_deleted))) };
    if (sql.startsWith('SELECT id FROM noco.platforms')) return { rows: [{ id: values[0] === 'linkedin' ? 16 : 31 }] };
    if (sql.startsWith('INSERT INTO noco.platform_accounts')) {
      const columns = sql.match(/platform_accounts\(([^)]+)\)/)![1].split(',');
      const row = Object.fromEntries(columns.map((key, i) => [key, values[i]]));
      row.id = row.id === undefined ? nextId++ : Number(row.id);
      row._copy_id ??= '[]';
      if (state.accounts.some(previous => previous._copy_id === row._copy_id))
        throw Object.assign(new Error('unique identity violation'), { code: '23505' });
      Object.assign(row, { platform: row.platforms_id === 16 ? 'linkedin' : 'email_outlook' });
      state.accounts.push(row); return { rows: [{ id: row.id }] };
    }
    if (sql.startsWith('UPDATE noco.platform_accounts')) {
      if(sql.includes('SET is_banned=true')){const row=state.accounts.find(row=>Number(row.id)===Number(values[0])&&Number(row.clients_id)===Number(values[1]));if(row){row.is_banned=true;row.ban_version=`2026-10-30 00:00:00.${String(++banRevision).padStart(6,'0')}+00`;return{rows:[{id:row.id,ban_version:row.ban_version}]};}return{rows:[]};}
      if(sql.includes('SET is_banned=false')){
        const row=state.accounts.find(row=>Number(row.id)===Number(values[0])&&Number(row.clients_id)===Number(values[1])&&row.is_banned===true&&row.ban_version===values[2]);
        if(!row)return{rows:[]};row.is_banned=false;row.ban_version=`cancelled-${++banRevision}`;return{rows:[{id:row.id}]};
      }
      if(sql.includes('__nc_deleted=true')){
        const rows=state.accounts.filter(row=>row.clients_id===values[0]&&(values[1] as number[]).includes(Number(row.id))&&!row.__nc_deleted);
        for(const row of rows)row.__nc_deleted=true;
        return{rows:rows.map(row=>({id:row.id}))};
      }
      const row = state.accounts.find(r => r.id === values[0])!;
      for (const m of sql.matchAll(/(\w+)=\$(\d+)/g)) if (!['id','clients_id'].includes(m[1])) row[m[1]] = values[Number(m[2]) - 1];
      return { rows: [] };
    }
    if (sql.includes('FROM noco.octo_profiles')) return { rows: state.profiles };
    if (sql.startsWith("SELECT state->'setup' AS setup FROM noco.octo_clients")) return {rows:state.client?[{setup:(state.client.state as any)?.setup}]:[]};
    if (sql.startsWith('SELECT client_id,password,revision,state FROM noco.octo_clients')) return { rows: state.client ? [state.client] : [] };
    if (sql.startsWith('INSERT INTO noco.octo_clients')) {
      state.client = { client_id: values[0], password: values[1], revision: 1, state: JSON.parse(String(values[2])) };
      return { rows: [structuredClone(state.client)] };
    }
    if (sql.startsWith('UPDATE noco.octo_clients')) {
      if (control.failQueue) throw Error('queue failed');
      state.client = { client_id: values[0], password: values[2], revision: Number(values[1]) + 1, state: JSON.parse(String(values[3])) };
      return { rows: [structuredClone(state.client)] };
    }
    return { rows: [] };
  } }; } };
  return { state, control, calls, store: createLinkedInIntakeStore(pool, 'unicorn_noco_copy_restore', false, creationTasks,afterBan) };
}

test('saving existing credentials before Octo is durable, owner scoped and creates neither profiles nor ready notice',async()=>{
 const f=fixture(),raw={scenario:'existing',stage:'credentials',url:'https://linkedin.com/in/alex',login:'alex@example.com',password:'fixture'};
 const first=await f.store.save(7,parseIntake(raw),['ru','en']);
 const second=await f.store.save(7,parseIntake({...raw,password:''}),['ru','en']);
 assert.equal(first.linkedinAccountId,second.linkedinAccountId);
 assert.equal(f.state.accounts.length,1);assert.equal(f.state.accounts[0].linkedin_octo_connection_pending,true);
 assert.equal(f.state.accounts[0].password,'fixture');assert.equal(f.state.profiles.length,0);assert.equal(f.state.tasks.length,0);
 assert.ok(!f.calls.some(sql=>sql.startsWith('INSERT INTO noco.linkedin_intake_notifications')));
 const view=await f.store.load(7);assert.equal(view.octoConnectionPending,true);assert.equal(view.hasPassword,true);assert.equal('password' in view,false);
 await assert.rejects(f.store.save(7,parseIntake({...raw,stage:'complete',loggedIn:true}),['ru','en']),{code:'linkedin_intake_infrastructure_required'});
});

test('reporting a ban is owner-scoped and idempotent without creating tasks; both readers include the archived history',async()=>{
 const f=fixture(true);await f.store.save(7,input(),['ru','en']);
 Object.assign(f.state.accounts[0],{url:'https://linkedin.com/in/old'});
 f.state.tasks[0].status='выполнение подтверждено';
 const counts=[f.state.accounts.length,f.state.tasks.length];
 await assert.rejects(f.store.reportBan(7,999),{code:'linkedin_intake_replacement_stale'});
 await f.store.reportBan(7,Number(f.state.accounts[0].id));await f.store.reportBan(7,Number(f.state.accounts[0].id));
 assert.equal(f.state.accounts[0].is_banned,true);assert.deepEqual([f.state.accounts.length,f.state.tasks.length],counts);
 assert.equal(f.calls.filter(sql=>sql.includes('SET is_banned=true')).length,1);
 assert.equal((await f.store.load(7)).isBanned,true);
});

test('master CRM hook observes a committed ban once; cancellation does not send an implicit CRM unban',async()=>{
 const deliveries:unknown[]=[];
 const f=fixture(true,async(clientId,accountId)=>{
  assert.equal(f.calls.at(-1),'COMMIT','external CRM work runs after the SQL commit');
  assert.equal(f.state.accounts[0].is_banned,true);deliveries.push([clientId,accountId]);throw Error('mock CRM failure');
 });
 await f.store.save(7,input(),['ru','en']);const id=Number(f.state.accounts[0].id);
 Object.assign(f.state.accounts[0],{url:'https://linkedin.com/in/old'});f.state.tasks[0].status='выполнение подтверждено';
 const first=await f.store.reportBan(7,id);await f.store.reportBan(7,id);
 assert.deepEqual(deliveries,[[7,id]]);assert.ok(first.banUndoVersion);
 await f.store.cancelBan(7,id,first.banUndoVersion!);
 assert.equal(f.state.accounts[0].is_banned,false);assert.equal(deliveries.length,1);
});

test('reported current account appears in blocked history immediately; cancellation restores only this ban',async()=>{
 const f=fixture(true);await f.store.save(7,input(),['ru','en']);
 const li=f.state.accounts[0],id=Number(li.id);Object.assign(li,{url:'https://linkedin.com/in/old',login:'old@example.test',password:'never-return'});
 f.state.tasks[0].status='выполнение подтверждено';
 const original=JSON.stringify(li.old_link_blocked),counts=[f.state.accounts.length,f.state.tasks.length];
 const report=await f.store.reportBan(7,id);
 assert.equal(typeof report.banUndoVersion,'string');
 assert.equal((await f.store.reportBan(7,id)).banUndoVersion,undefined,'an already banned account grants no new undo');
 const bannedView=await f.store.load(7);
 assert.equal(bannedView.archivedBlockedAccounts?.length,1);
 assert.match(bannedView.archivedBlockedAccounts![0].legacyText!,/https:\/\/linkedin.com\/in\/old/);
 assert.match(bannedView.archivedBlockedAccounts![0].legacyText!,/old@example.test/);
 assert.ok(!JSON.stringify(bannedView).includes('never-return'));
 await f.store.cancelBan(7,id,report.banUndoVersion!);
 await f.store.cancelBan(7,id,report.banUndoVersion!);
 assert.equal(f.state.accounts[0].is_banned,false);
 const restored=await f.store.load(7);assert.equal(restored.archivedBlockedAccounts?.length,0);
 assert.deepEqual(restored.editableBlockedAccounts,input().blockedAccounts);
 assert.equal(JSON.stringify(f.state.accounts[0].old_link_blocked),original);
 assert.deepEqual([f.state.accounts.length,f.state.tasks.length],counts);
});

test('ban cancellation rejects another owner, changed data and a pending/replaced application',async()=>{
 const f=fixture(true);await f.store.save(7,input(),['ru','en']);
 const id=Number(f.state.accounts[0].id);Object.assign(f.state.accounts[0],{url:'https://linkedin.com/in/old'});
 f.state.tasks[0].status='выполнение подтверждено';
 const report=await f.store.reportBan(7,id);
 await assert.rejects(f.store.cancelBan(8,id,report.banUndoVersion!),{code:'linkedin_intake_replacement_stale'});
 await assert.rejects(f.store.cancelBan(7,id,'changed-version'),{code:'linkedin_intake_ban_changed'});
 assert.equal(f.state.accounts[0].is_banned,true);
 f.state.tasks[0].status='не начата';
 await assert.rejects(f.store.cancelBan(7,id,report.banUndoVersion!),{code:'linkedin_intake_registration_pending'});
 f.state.tasks[0].status='выполнение подтверждено';
 await f.store.save(7,{...input(),replacesLinkedInAccountId:id},['ru','en']);
 await assert.rejects(f.store.cancelBan(7,id,report.banUndoVersion!),{code:'linkedin_intake_replacement_stale'});
 assert.equal(f.state.accounts.find(a=>Number(a.id)===id)?.is_banned,true);
});

test('an uncertain cancellation is read back without repeating the status update',async()=>{
 const f=fixture(true);await f.store.save(7,input(),['ru','en']);
 const id=Number(f.state.accounts[0].id);Object.assign(f.state.accounts[0],{url:'https://linkedin.com/in/old'});f.state.tasks[0].status='выполнение подтверждено';
 const report=await f.store.reportBan(7,id);f.control.uncertain=true;
 await assert.rejects(f.store.cancelBan(7,id,report.banUndoVersion!),{code:'commit_uncertain'});
 assert.equal((await f.store.load(7)).isBanned,false);
 await f.store.cancelBan(7,id,report.banUndoVersion!);
 assert.equal(f.calls.filter(sql=>sql.includes('SET is_banned=false')).length,1);
});

test('Outlook registration time round-trips on the email account and survives legacy updates and rollback', async () => {
  const f = fixture();
  const outlookRegisteredAt = '2026-10-25T10:30:00.123Z';
  await f.store.save(7, { ...input(), outlookRegisteredAt }, ['ru','en']);
  assert.equal(f.state.accounts[0].outlook_registered_at, undefined);
  assert.equal(f.state.accounts[1].outlook_registered_at, outlookRegisteredAt);
  assert.equal((await f.store.load(7)).outlookRegisteredAt, outlookRegisteredAt);
  await f.store.save(7, { ...input(), outlookPassword: '' }, ['ru','en']);
  assert.equal((await f.store.load(7)).outlookRegisteredAt, outlookRegisteredAt);
  f.control.failQueue = true;
  f.state.client = undefined;
  await assert.rejects(f.store.save(7, { ...input(), outlookRegisteredAt: '2026-10-24T10:30:00.000Z' }, ['ru','en']));
  assert.equal((await f.store.load(7)).outlookRegisteredAt, outlookRegisteredAt);
  f.state.accounts[1].outlook_registered_at = new Date(outlookRegisteredAt);
  assert.equal((await f.store.load(7)).outlookRegisteredAt, outlookRegisteredAt);
});

test('hidden historical newFullName survives loading and saving alongside other blocked account fields', async () => {
  const f = fixture();
  const data = { ...input(), blockedAccounts: [{ fullName: 'Old Name', newFullName: 'Previously Saved Name' }] };
  await f.store.save(7, data, ['ru','en']);
  const loaded = await f.store.load(7);
  assert.deepEqual(loaded.blockedAccounts, data.blockedAccounts);
  await f.store.save(7, { ...input(), outlookPassword: '', blockedAccounts: loaded.blockedAccounts }, ['ru','en']);
  assert.deepEqual((await f.store.load(7)).blockedAccounts, data.blockedAccounts);
});

test('student save creates one referenced task, repeated saves update it and preserve other manual tasks',async()=>{
  const f=fixture(true);
  const first=await f.store.save(7,input(),['ru','en']);
  assert.equal(first.task?.created,true);
  f.state.tasks.push({...f.state.tasks[0],id:99,source:'manual'});
  const next=await f.store.save(7,{...input(),outlookPassword:''},['ru','en']);
  assert.equal(next.task?.created,false);assert.equal(next.task?.id,first.task?.id);assert.equal(f.state.tasks.length,2);
  assert.equal(f.state.tasks[0].linkedin_account_id,f.state.accounts[0].id);
  assert.equal(f.state.tasks[0].outlook_account_id,f.state.accounts[1].id);
  assert.ok(!JSON.stringify(f.state.tasks).includes('mail-secret'));
});

test('open and blocked intake edits retain the task, account identities and expert draft without queueing profiles again',async()=>{
  for(const status of ['не начата','блок']){
    const f=fixture(true);const initial=await f.store.save(7,input(),['ru','en']);
    f.state.tasks[0].status=status;
    Object.assign(f.state.accounts[0],{url:'https://linkedin.com/in/expert-draft',login:'expert-draft',password:'expert-secret'});
    const ids=f.state.accounts.map(a=>a.id),profileState=structuredClone(f.state.client);
    const beforeEdit=f.calls.length;
    const updated=await f.store.save(7,{...input(),outlookLogin:'corrected@outlook.com',outlookPassword:'',realLocation:'Yerevan'},['ru','en']);
    assert.ok(!f.calls.slice(beforeEdit).some(sql=>sql.includes('noco.octo_')),'editing does not queue or touch Octo setup');
    assert.equal(updated.task?.id,initial.task?.id);assert.equal(updated.task?.created,false);
    assert.deepEqual(f.state.accounts.map(a=>a.id),ids);assert.equal(f.state.tasks.length,1);
    assert.equal(f.state.accounts[0].url,'https://linkedin.com/in/expert-draft');
    assert.equal(f.state.accounts[0].login,'expert-draft');assert.equal(f.state.accounts[0].password,'expert-secret');
    assert.equal(f.state.accounts[1].login,'corrected@outlook.com');assert.equal(f.state.accounts[1].password,'mail-secret');
    assert.deepEqual(f.state.client,profileState);
    await assert.rejects(f.store.save(7,parseIntake({scenario:'existing',url:'https://linkedin.com/in/other',login:'other',loggedIn:true}),['ru','en']),{code:'linkedin_intake_registration_pending'});
    f.state.tasks[0].status='сделана экспертом';const before=structuredClone(f.state);
    await assert.rejects(f.store.save(7,input(),['ru','en']),{code:'linkedin_task_student_edit_locked'});
    assert.deepEqual(f.state,before);
  }
});

test('confirmed task exposes read-only Octo access; expert completion stays locked without student access',async()=>{
  const f=fixture(true);await f.store.save(7,input(),['ru','en']);
  f.state.tasks[0].status='сделана экспертом';
  assert.equal((await f.store.load(7)).completionConfirmed,false);
  f.state.tasks[0].status='выполнение подтверждено';
  const confirmed=await f.store.load(7);
  assert.equal(confirmed.editLocked,true);assert.equal(confirmed.completionConfirmed,true);
});

test('replacement exposes archived LinkedIn history and pre-request profiles, excluding newly prepared and deleting profiles',async()=>{
  const f=fixture(true);await f.store.save(7,input(),['ru','en']);
  Object.assign(f.state.accounts[0],{url:'https://linkedin.com/in/old'});f.state.tasks[0].status='выполнение подтверждено';
  await f.store.save(7,{...input(),replacesLinkedInAccountId:Number(f.state.accounts[0].id)},['ru','en']);
  const at=new Date(String(f.state.tasks[1].created_at)).getTime();
  f.state.profiles=[{profile_id:350,state:{createdAt:at-1000}},{profile_id:351,state:{createdAt:at+1000}},
    {profile_id:352,state:{createdAt:at-1000,deletion:{}}}];
  const loaded=await f.store.load(7);
  assert.equal(loaded.hasLinkedIn,false);assert.equal(loaded.registrationPending,true);
  assert.equal(loaded.hadLinkedInBeforeTask,true);assert.deepEqual(loaded.previousOctoProfileIds,[350]);
});

test('a bound manual request is edited in place instead of creating a second student request',async()=>{
  const f=fixture(true);await f.store.save(7,input(),['ru','en']);f.state.tasks[0].source='manual';
  const updated=await f.store.save(7,{...input(),outlookPassword:'',realLocation:'Yerevan'},['ru','en']);
  assert.equal(updated.task?.id,1);assert.equal(updated.task?.created,false);assert.equal(f.state.tasks.length,1);
  assert.equal(f.state.tasks[0].source,'manual');
});

test('in-progress registration cannot be reported banned, including manual applications with result fields already filled',async()=>{
  const f=fixture(true);await f.store.save(7,input(),['ru','en']);
  Object.assign(f.state.accounts[0],{url:'https://linkedin.com/in/not-yet-confirmed',login:'temporary',password:'temporary'});
  f.state.tasks.push({...f.state.tasks[0],id:99,source:'manual',status:'выполнение подтверждено'});
  for(const source of ['student_intake','manual'])for(const status of ['не начата','блок','сделана экспертом']){
    Object.assign(f.state.tasks[0],{source,status});
    const before=structuredClone(f.state);
    assert.equal((await f.store.load(7)).registrationPending,true);
    assert.equal((await f.store.load(7)).completionConfirmed,false,'an older confirmation cannot override the unfinished request');
    await assert.rejects(f.store.save(7,{...input(),replacesLinkedInAccountId:Number(f.state.accounts[0].id)},['ru','en']),{code:'linkedin_intake_registration_pending'});
    assert.deepEqual(f.state,before);
  }
  f.state.tasks[0].status='выполнение подтверждено';
  assert.equal((await f.store.load(7)).registrationPending,false);
});

test('ban replacement archives old credentials and tasks, creates one fresh application and rejects a duplicate submission',async()=>{
  const f=fixture(true);await f.store.save(7,input(),['ru','en']);
  Object.assign(f.state.accounts[0],{url:'https://linkedin.com/in/banned',login:'old@example.org',password:'old-li-secret'});
  f.state.tasks[0].status='выполнение подтверждено';
  const oldAccounts=structuredClone(f.state.accounts),oldId=Number(f.state.accounts[0].id);
  const replacement={...input(),outlookLogin:'replacement@outlook.com',outlookPassword:'new-mail-secret',replacesLinkedInAccountId:oldId};
  const saved=await f.store.save(7,replacement,['ru','en'],{createOctoProfiles:true});
  assert.equal(saved.task?.created,true);assert.notEqual(saved.task?.id,1);
  assert.equal(f.state.tasks[0].status,'выполнение подтверждено');assert.equal(f.state.tasks[0].source,'manual');
  for(const old of oldAccounts){const archived=f.state.accounts.find(row=>row.id===old.id)!;
    assert.equal(archived.__nc_deleted,true);assert.equal(archived.password,old.password);assert.equal(archived.login,old.login);}
  assert.equal(f.state.accounts.filter(row=>!row.__nc_deleted).length,2);
  const loaded=await f.store.load(7);assert.equal(loaded.url,'');assert.equal(loaded.outlookLogin,'replacement@outlook.com');
  assert.equal(loaded.editLocked,false);assert.equal(loaded.task?.id,saved.task?.id);
  await assert.rejects(f.store.save(7,replacement,['ru','en']),{code:'linkedin_intake_replacement_stale'});
  assert.equal(f.state.accounts.length,4);assert.equal(f.state.tasks.length,2);
});

test('replacement failure rolls back archival and task retirement; old mailbox password cannot satisfy a new mailbox',async()=>{
  const f=fixture(true);await f.store.save(7,input(),['ru','en']);
  f.state.tasks[0].status='выполнение подтверждено';
  Object.assign(f.state.accounts[0],{url:'https://linkedin.com/in/banned',password:'old-secret'});
  const id=Number(f.state.accounts[0].id),before=structuredClone(f.state);
  await assert.rejects(f.store.save(7,{...input(),outlookPassword:'',replacesLinkedInAccountId:id},['ru','en']),{code:'linkedin_intake_outlook_password_required'});
  f.control.failTask=true;
  await assert.rejects(f.store.save(7,{...input(),replacesLinkedInAccountId:id},['ru','en']));
  assert.deepEqual(f.state,before);
});

test('a replacement cannot archive another client account or a stale account ID',async()=>{
  const f=fixture(true);await f.store.save(7,input(),['ru','en']);
  Object.assign(f.state.accounts[0],{url:'https://linkedin.com/in/current'});
  f.state.accounts.push({id:99,clients_id:8,platform:'linkedin',platforms_id:16,url:'https://linkedin.com/in/foreign',password:'foreign-secret'});
  const before=structuredClone(f.state);
  await assert.rejects(f.store.save(7,{...input(),replacesLinkedInAccountId:99},['ru','en']),{code:'linkedin_intake_replacement_stale'});
  await assert.rejects(f.store.save(8,{...input(),replacesLinkedInAccountId:1},['ru','en']),{code:'linkedin_intake_replacement_stale'});
  assert.deepEqual(f.state,before);
  f.state.tasks[0].linkedin_account_id=100;
  const unrelatedTask=structuredClone(f.state);
  await assert.rejects(f.store.save(7,{...input(),replacesLinkedInAccountId:Number(f.state.accounts[0].id)},['ru','en']),{code:'linkedin_intake_replacement_stale'});
  assert.deepEqual(f.state,unrelatedTask,'an unrelated current student request is not silently overwritten');
});

test('an uncertain replacement commit is read back and never repeats archival or application creation',async()=>{
  const f=fixture(true);await f.store.save(7,input(),['ru','en']);
  f.state.tasks[0].status='выполнение подтверждено';
  Object.assign(f.state.accounts[0],{url:'https://linkedin.com/in/banned'});
  const replacement={...input(),replacesLinkedInAccountId:Number(f.state.accounts[0].id)};
  f.control.uncertain=true;
  await assert.rejects(f.store.save(7,replacement,['ru','en']),{code:'commit_uncertain'});
  assert.equal((await f.store.load(7)).task?.id,2);
  await assert.rejects(f.store.save(7,replacement,['ru','en']),{code:'linkedin_intake_replacement_stale'});
  assert.equal(f.state.accounts.length,4);assert.equal(f.state.tasks.length,2);
});
test('task failure rolls back both accounts and Octo intent; locked task rejects stale student save',async()=>{
  const f=fixture(true);f.control.failTask=true;
  await assert.rejects(f.store.save(7,input(),['ru','en']),{code:'postgres_write_failed'});
  assert.equal(f.state.accounts.length,0);assert.equal(f.state.client,undefined);
  f.control.failTask=false;await f.store.save(7,input(),['ru','en']);
  for(const status of ['сделана экспертом','выполнение подтверждено']) {
    f.state.tasks[0].status=status;
    const original=structuredClone(f.state.accounts);
    await assert.rejects(f.store.save(7,{...input(),firstName:'Changed'},['ru','en']),{code:'linkedin_task_student_edit_locked'});
    assert.deepEqual(f.state.accounts,original);
  }
});
test('intake and direct Octo intent commit together; repeated save preserves intent and existing secrets', async () => {
  const f = fixture(); await f.store.save(7, input(), ['ru','en']);
  const original = structuredClone(f.state.client);
  await f.store.save(7, { ...input(), outlookPassword: '' }, ['ru','en']);
  assert.equal(f.state.accounts.length, 2); assert.deepEqual(f.state.client, original);
  assert.deepEqual(f.state.accounts.map(row => row._copy_id), f.state.accounts.map(row => JSON.stringify([String(row.id)])));
  assert.equal(f.state.accounts[0].url, undefined);
  assert.equal(f.state.accounts[1].password, 'mail-secret');
  assert.deepEqual(JSON.parse(String(f.state.accounts[0].old_link_blocked)), input().blockedAccounts);
  assert.equal((f.state.client!.state as { setup: { source: string } }).setup.source, 'direct');
  const loaded = await f.store.load(7);
  assert.equal(loaded.hasOutlookPassword, true); assert.ok(!JSON.stringify(loaded).includes('mail-secret'));
});
test('queue failure rolls back account saves; uncertain commit is reconciled by a repeat without duplicates', async () => {
  const f = fixture(); f.control.failQueue = true;
  await assert.rejects(f.store.save(7, input(), ['ru','en']), { code: 'postgres_write_failed' });
  assert.equal(f.state.accounts.length, 0); assert.equal(f.state.client, undefined);
  f.control.failQueue = false; f.control.uncertain = true;
  await assert.rejects(f.store.save(7, input(), ['ru','en']), { code: 'commit_uncertain' });
  await f.store.save(7, input(), ['ru','en']); assert.equal(f.state.accounts.length, 2);
});
test('ambiguous accounts, missing password and replacing an existing LinkedIn with new intake are rejected', async () => {
  const f = fixture(); await f.store.save(7, input(), ['ru','en']);
  f.state.accounts[0].url = 'https://linkedin.com/in/alex';
  await assert.rejects(f.store.save(7, input(), ['ru','en']), { code: 'linkedin_intake_existing_account' });
  f.state.accounts.push({ ...f.state.accounts[0], id: 99 });
  await assert.rejects(f.store.load(7), { code: 'linkedin_intake_account_ambiguous' });
  const empty = fixture();
  await assert.rejects(empty.store.save(7, { ...input(), outlookPassword: '' }, ['ru','en']), { code: 'linkedin_intake_outlook_password_required' });
});
test('existing LinkedIn saves require ready EN proxy and keep blank submitted secrets unchanged', async () => {
  const f = fixture(); f.state.accounts.push({ id: 1, clients_id: 7, platforms_id: 16, platform: 'linkedin', password: 'li-secret' });
  const data = parseIntake({ scenario: 'existing', url: 'https://linkedin.com/in/alex', login: 'alex', loggedIn: true });
  await assert.rejects(f.store.save(7, data, ['ru','en']), { code: 'linkedin_intake_infrastructure_required' });
  f.state.profiles = [{ locale: 'ru', state: { phase: 'ready' } }, { locale: 'en', state: { phase: 'ready', proxy: { host: 'proxy.example.com' } } }];
  await f.store.save(7, data, ['ru','en']);
  assert.equal(f.state.accounts[0].password, 'li-secret'); assert.equal(f.state.accounts[0].url, data.url);
  assert.equal(f.state.client, undefined, 'existing workflow never queues replacement profiles');
});

test('Outlook-only preparation for Dolphin does not touch Octo state or create Octo jobs', async () => {
  const f = fixture();
  await f.store.save(7, input(), ['ru','en'], { createOctoProfiles: false });
  assert.equal(f.state.accounts.length, 2);
  assert.equal(f.state.client, undefined);
  assert.ok(!f.calls.some(sql => sql.includes('noco.octo_clients') || sql.includes('noco.octo_profiles')));
});

test('existing ready Octo profiles, attached proxy and completed setup remain unchanged', async () => {
  const f = fixture();
  f.state.profiles = [{ locale: 'ru', state: { phase: 'ready' } }, { locale: 'en', state: { phase: 'ready', proxy: { host: 'retained.example.com' } } }];
  f.state.client = { client_id: 7, password: '00321', revision: 7,
    state: { clientId: 7, password: '00321', revision: 7, setup: { source: 'nodemaven', phase: 'complete' } } };
  const original = structuredClone({ client: f.state.client, profiles: f.state.profiles });
  await f.store.save(7, input(), ['ru','en']);
  assert.deepEqual({ client: f.state.client, profiles: f.state.profiles }, original);
});
