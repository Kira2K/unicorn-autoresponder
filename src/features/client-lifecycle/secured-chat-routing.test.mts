import assert from 'node:assert/strict';
import test from 'node:test';
import { COPY_MARKER, type SqlPool } from '../../integrations/postgres/contracts.mts';
import { clientLifecycleStore } from './postgres-store.mts';

function fixture(secured: unknown) {
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  const row: Record<string, unknown> = { id: 1, client_name: 'Fixture', client_status: 'studying', client_role: 'student',
    telegram_general_chat_id: '-12', secured_general_chat_id: secured, telegram_personal_chat_id: '@fixture', market_id: 1,
    google_folder: 'https://example.invalid/folder', tg_hard_mentor: '@mentor', indicators: {} };
  const pool: SqlPool = { async end() {}, async connect() { return { release() {}, async query(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('current_database()')) return { rows: [{ database: 'unicorn_noco_copy_restore', marker: COPY_MARKER }] };
    if (sql.includes('SELECT c.id,c.client_name')) return { rows: [row] };
    if (sql.startsWith('SELECT id FROM noco.clients')) return { rows: [{ id: 1 }] };
    if (sql.includes('telegram_notification_try_claim()')) return { rows: [{ claimed: true }] };
    if (sql.includes('INSERT INTO noco.client_notifications')) return { rows: [{ event_key: 'fixture' }] };
    return { rows: [] };
  } }; } };
  return { calls, store: clientLifecycleStore(pool, 'unicorn_noco_copy_restore') };
}

test('lifecycle notifications prefer secured groups; only blank secured values permit fallback', async () => {
  for (const secured of [' -10034 ', undefined, null, '', '  ', 'invalid']) {
    const f = fixture(secured), [{ client }] = await f.store.clients();
    assert.equal(client.chatId, String(secured ?? '').trim() || '-12');
    assert.equal(client.id, 1); assert.equal(client.tag, '@fixture');
    assert.ok(f.calls.some(c => c.sql.includes("to_jsonb(c)->>'secured_general_chat_id' AS secured_general_chat_id")),
      'optional field must be read even without catalog registration');
    assert.ok(f.calls.every(c => !/INSERT|UPDATE|DELETE/.test(c.sql)), 'reading targets is side-effect free');
  }
});

test('lifecycle claim guard rechecks the effective group under lock before claiming delivery', async () => {
  const f = fixture('-10034'), [{ client }] = await f.store.clients();
  assert.equal(await f.store.delivery.claim('fixture', 1, 'status', [], new Date('2026-10-19T00:00:00Z'), 'studying', client), true);
  const guard = f.calls.find(c => c.sql.startsWith('SELECT id FROM noco.clients'))!;
  assert.match(guard.sql, /NULLIF\(btrim\(to_jsonb\(c\)->>'secured_general_chat_id'\),''\)/);
  assert.match(guard.sql, /FOR UPDATE/);
  assert.equal(JSON.parse(String(guard.values[2]))[1], '-10034');
  assert.equal(f.calls.filter(c => c.sql.includes('INSERT INTO noco.client_notifications')).length, 1);
});
