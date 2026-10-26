import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPY_MARKER } from '../../../integrations/postgres/contracts.mts';
import type { SqlPool } from '../../../integrations/postgres/contracts.mts';
import { createLinkedInIntakeStore } from './postgres-store.mts';
import { parseIntake } from './contracts.mts';
import { tableIds } from '../../web-console/backend/postgres/tables.mts';
const input = () => parseIntake({ scenario: 'new', outlookLogin: 'alex@outlook.com', outlookPassword: 'mail-secret',
  firstName: 'Alex', lastName: 'Smith', realLocation: 'Tbilisi', blockedAccounts: [{ fullName: 'Old Alex' }, { country: 'UK' }] });
function fixture(creationTasks = false) {
  const state: { accounts: Record<string, unknown>[]; client?: Record<string, unknown>; profiles: Record<string, unknown>[]; tasks: Record<string,unknown>[] } = { accounts: [], profiles: [], tasks: [], client: undefined };
  const control = { failQueue: false, failTask: false, uncertain: false }, calls: string[] = [];
  let backup = structuredClone(state);
  let nextId = 1;
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
    if (sql.includes('FROM noco.linkedin_creation_task')) return { rows: state.tasks.filter(t=>Number(t.client_id)===Number(values[0])) };
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
    if (sql.includes('FROM noco.platform_accounts a JOIN')) return { rows: structuredClone(state.accounts) };
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
      const row = state.accounts.find(r => r.id === values[0])!;
      for (const m of sql.matchAll(/(\w+)=\$(\d+)/g)) if (!['id','clients_id'].includes(m[1])) row[m[1]] = values[Number(m[2]) - 1];
      return { rows: [] };
    }
    if (sql.includes('FROM noco.octo_profiles')) return { rows: state.profiles };
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
  return { state, control, calls, store: createLinkedInIntakeStore(pool, 'unicorn_noco_copy_restore', false, creationTasks) };
}

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
