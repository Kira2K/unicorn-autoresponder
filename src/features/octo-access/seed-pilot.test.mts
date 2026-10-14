import test from 'node:test';
import assert from 'node:assert/strict';
import { seedPilot, parseSeedArgs } from './seed-pilot.mts';
import type { WorkingTable } from '../../integrations/postgres/working-catalog.mts';
import type { PostgresTransaction } from '../../integrations/postgres/working-client.mts';
import { createRequire } from 'node:module';
const { getRequiredClientDataIssues } = createRequire(import.meta.url)('../web-console/backend/dolphin-profile-provisioning.ts') as {
  getRequiredClientDataIssues(client: unknown, options: { requireCalendarEmail: boolean }): unknown[];
};

function fixture(fallback = false) {
  const data: Record<string, Record<string, unknown>[]> = { clients: [], stacks: [{ Id: 4, name: 'FRONTEND' }],
    market: [{ Id: 1, market: 'ru' },{ Id: 2,market:'En' }] };
  const columns = ['client_name', 'first_name', 'last_name', 'calendar_email', 'telegram_general_chat_id', 'client_status',
    ...(fallback ? [] : ['legend_info'])].map(dataKey => ({ id: dataKey, title: dataKey, dataKey, sqlName: dataKey, sqlType: 'text' }));
  columns.push(...['stacks_id', 'market_id'].map(dataKey => ({ id: dataKey, title: dataKey, dataKey, sqlName: dataKey, sqlType: 'bigint' })));
  if (fallback) columns.push({ id: 'nc_row_meta', title: 'nc_row_meta', dataKey: 'nc_row_meta', sqlName: 'nc_row_meta', sqlType: 'jsonb' });
  const tables = Object.keys(data).map(id => ({ id, title: id, columns: id === 'clients' ? columns : [] })) as unknown as WorkingTable[];
  const calls: string[] = []; let failSecond = false;
  const read = { async listRecords(id: string, options?: { after?: string[] }) {
    calls.push(`read:${id}`);
    const start = options?.after ? Number(options.after[0]) : 0;
    const selected = data[id].slice(start, start + 1);
    return { records: selected.map(row => ({ key: [String(row.Id)], data: structuredClone(row), sourceJson: '{}' })),
      nextKey: start + 1 < data[id].length ? [String(start + 1)] : null };
  } };
  const tx = { ...read, async lockKey(id: string, key: string) { calls.push(`lock:${id}:${key}`); },
    async createRecord(id: string, row: Record<string, unknown>) {
      assert.equal(id, 'clients'); calls.push('create');
      if (failSecond && data.clients.length === 1) throw new Error('synthetic_create_failure');
      const created = { ...row, Id: 100 + data.clients.length };
      data.clients.push(created); return { key: [String(created.Id)], data: created, sourceJson: '{}' };
    } } as unknown as PostgresTransaction;
  const db = { ...read, listTables: () => tables,
    async transaction<T>(fn: (tx: PostgresTransaction) => Promise<T>) {
      calls.push('begin'); const before = structuredClone(data.clients);
      try { const value = await fn(tx); calls.push('commit'); return value; }
      catch (e) { data.clients = before; calls.push('rollback'); throw e; }
    } };
  return { db, data, calls, failSecond: () => { failSecond = true; } };
}

test('default and --dry-run preview perform reads only and report no invented IDs', async () => {
  assert.equal(parseSeedArgs([]), false); assert.equal(parseSeedArgs(['--dry-run']), false);
  assert.equal(parseSeedArgs(['--apply']), true); assert.throws(() => parseSeedArgs(['--anything']));
  const f = fixture();
  assert.deepEqual(await seedPilot(f.db), { mode: 'preview', clients: [
    { fixture: 'Alex', clientId: null, action: 'would_create' }, { fixture: 'Bob', clientId: null, action: 'would_create' }] });
  assert.ok(f.calls.every(c => c.startsWith('read:'))); assert.equal(f.data.clients.length, 0);
});

test('apply creates exactly two paused Ru clients, takes the lock, and is idempotent', async () => {
  for (const fallback of [false, true]) {
    const f = fixture(fallback), first = await seedPilot(f.db, true);
    assert.deepEqual(first.clients.map(c => c.clientId), [100, 101]);
    assert.equal(f.calls[1], 'lock:clients:octo-pilot-v1');
    assert.deepEqual(f.data.clients.map(c => [c.first_name, c.last_name, c.calendar_email, c.telegram_general_chat_id,
      c.client_status, c.stacks_id, c.market_id]), [
      ['Alex', 'OctoTest', 'alex.octo@example.com', 'octo-test-alex', 'paused', 4, 1],
      ['Bob', 'OctoTest', 'bob.octo@example.com', 'octo-test-bob', 'paused', 4, 1] ]);
    const repeat = await seedPilot(f.db, true);
    assert.deepEqual(repeat.clients.map(c => [c.clientId, c.action]), [[100, 'existing'], [101, 'existing']]);
    assert.equal(f.calls.filter(c => c === 'create').length, 2);
  }
});

test('unmarked name/email/chat collisions and changed marked fixtures fail without writes', async () => {
  for (const collision of [ { calendar_email: 'BOB.OCTO@EXAMPLE.COM' }, { client_name: 'Bob OctoTest' },
    { telegram_general_chat_id: 'octo-test-bob' } ]) {
    const f = fixture(); f.data.clients.push({ Id: 99, ...collision });
    await assert.rejects(seedPilot(f.db, true), /octo_pilot_fixture_collision/);
    assert.ok(!f.calls.includes('create')); assert.equal(f.data.clients.length, 1);
  }
  const f = fixture(); await seedPilot(f.db, true); f.data.clients[1].client_status = 'active';
  const before = structuredClone(f.data.clients);
  await assert.rejects(seedPilot(f.db, true), /octo_pilot_fixture_collision/);
  assert.deepEqual(f.data.clients, before);
});

test('second insert failure rolls both clients back; missing stack fails before inserts', async () => {
  const f = fixture(); f.failSecond();
  await assert.rejects(seedPilot(f.db, true), /synthetic_create_failure/);
  assert.deepEqual(f.data.clients, []); assert.equal(f.calls.at(-1), 'rollback');
  const g = fixture(); g.data.stacks = [];
  await assert.rejects(seedPilot(g.db, true), /octo_pilot_frontend_stack_required/);
  assert.ok(!g.calls.includes('create'));
});

test('proxy fixture CLI is opt-in and rejects ambiguous modes and repeated flags', () => {
  assert.equal(parseSeedArgs(['--proxy-fixture']),false);
  assert.equal(parseSeedArgs(['--proxy-fixture','--dry-run']),false);
  assert.equal(parseSeedArgs(['--apply','--proxy-fixture']),true);
  for (const args of [['--apply','--dry-run'],['--proxy-fixture','--proxy-fixture'],['--apply','--apply']])
    assert.throws(() => parseSeedArgs(args), /octo_pilot_invalid_arguments/);
});

test('proxy group previews one client and idempotently creates only the paused En fixture', async () => {
  for (const fallback of [false,true]) {
    const f = fixture(fallback);
    assert.deepEqual(await seedPilot(f.db,false,'proxy-fixture'), { mode:'preview',clients:[
      { fixture:'Test For Octo Proxy creation',clientId:null,action:'would_create' }] });
    assert.ok(f.calls.every(c => c.startsWith('read:')));
    await seedPilot(f.db,true);
    const defaults = structuredClone(f.data.clients);
    const result = await seedPilot(f.db,true,'proxy-fixture');
    assert.deepEqual(result.clients,[{ fixture:'Test For Octo Proxy creation',clientId:102,action:'created' }]);
    assert.deepEqual(f.data.clients.slice(0,2),defaults);
    const created = f.data.clients[2];
    assert.equal(created.first_name,'Test');
    assert.equal(created.last_name,'For Octo Proxy creation');
    assert.deepEqual(getRequiredClientDataIssues({
      id:created.Id, clientName:created.client_name, firstName:created.first_name,
      lastName:created.last_name, calendarEmail:created.calendar_email,
      commonChatId:created.telegram_general_chat_id, primaryStack:'FRONTEND', market:'En'
    }, { requireCalendarEmail:true }), []);
    assert.deepEqual([created.client_name,created.calendar_email,created.telegram_general_chat_id,
      created.client_status,created.stacks_id,created.market_id],
      ['Test For Octo Proxy creation','octo.proxy.test@example.com','invalid-octo-proxy-fixture-v1','paused',4,2]);
    assert.ok(f.calls.includes('lock:clients:octo-proxy-fixture-v1'));
    const before = structuredClone(f.data.clients);
    assert.deepEqual((await seedPilot(f.db,true,'proxy-fixture')).clients,
      [{ fixture:'Test For Octo Proxy creation',clientId:102,action:'existing' }]);
    assert.deepEqual(f.data.clients,before);
    assert.equal(f.calls.filter(c => c==='create').length,3);
  }
});

test('proxy fixture name, email, chat and altered marker collisions fail without writes', async () => {
  for (const collision of [{ client_name:'Test For Octo Proxy creation' },
    { calendar_email:'OCTO.PROXY.TEST@EXAMPLE.COM' },{ telegram_general_chat_id:'invalid-octo-proxy-fixture-v1' },
    { legend_info:'octo-proxy-fixture-v1:proxy-creation',client_status:'active' }]) {
    const f = fixture(); f.data.clients.push({ Id:99,...collision });
    await assert.rejects(seedPilot(f.db,true,'proxy-fixture'),/octo_pilot_fixture_collision/);
    assert.ok(!f.calls.includes('create'));
  }
  const f = fixture(); f.data.market = f.data.market.filter(m => m.market==='ru');
  await assert.rejects(seedPilot(f.db,true,'proxy-fixture'),/octo_pilot_en_market_required/);
  assert.ok(!f.calls.includes('create'));
});
