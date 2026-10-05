import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinkedInAutomationStore } from './linkedin-automation.mts';
import type { SqlPool } from './contracts.mts';
import { readFile } from 'node:fs/promises';

function fixture(answer: (sql: string, values: unknown[]) => unknown[] = () => []) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  let released = 0, open = false;
  const pool: SqlPool = { async end() {}, async connect() {
    assert.equal(open, false, 'No connection may remain pinned between store operations'); open = true;
    return { async query(sql, values = []) { calls.push({ sql, values }); return { rows: answer(sql, values) as any[] }; },
      release() { open = false; released++; } };
  } };
  return { store: createLinkedInAutomationStore(pool), calls, releases: () => released };
}

test('missing migration is detected read-only; backend does not run DDL', async () => {
  const f = fixture(); assert.equal(await f.store.ready(), false);
  assert.equal(f.calls[0].sql, 'BEGIN READ ONLY'); assert.equal(f.calls.at(-1)?.sql, 'COMMIT');
  assert.ok(!f.calls.some(c => /CREATE|ALTER|DROP/.test(c.sql))); assert.equal(f.releases(), 1);
});

test('status reads every active shared wait in one read-only query without changing deadlines', async () => {
  const cooldown = { account: 'a', method: '*', until: 1000, observedAt: 100, code: 'unipile_limit' };
  const f = fixture(sql => sql.includes('SELECT state FROM linkedin_automation.cooldowns') ? [{ state: cooldown }] : []);
  assert.deepEqual(await f.store.cooldowns!(), [cooldown]);
  assert.equal(f.calls.filter(c => c.sql.includes('SELECT')).length, 1);
  assert.equal(f.calls[0].sql, 'BEGIN READ ONLY');
  assert.ok(!f.calls.some(c => /UPDATE|INSERT|DELETE/.test(c.sql)));
});

test('history filters the retained log on the server and pages newest first without skipping boundaries', async () => {
  const f = fixture(sql => sql.includes('SELECT id,state') ? [{ id: '42', state: { message: 'test' } }] : []);
  const rows = await f.store.history(7, 0, 200, { latest: true, before: 43, source: 'SQL', feature: 'posts', errorsOnly: true, from: 100, to: 200 });
  assert.equal(rows[0].id, 42);
  const query = f.calls.find(c => c.sql.includes('SELECT id,state'))!;
  assert.match(query.sql, /id<\$4/); assert.match(query.sql, /ORDER BY id DESC/);
  const errorCodeFilter = new RegExp(/state->>'code' ~ '([^']+)'/.exec(query.sql)![1]);
  for (const code of ['comments_post_not_published', 'comments_not_started', 'post_account_not_ready'])
    assert.ok(errorCodeFilter.test(code), `The error filter must retain ${code}`);
  for (const code of ['active_day_finished', 'waiting_for_post', 'completed'])
    assert.equal(errorCodeFilter.test(code), false, `A normal wait or completion is not an error: ${code}`);
  assert.deepEqual(query.values, [7, 0, 200, 43, 'SQL', 'posts', true, 100, 200]);
  await f.store.history(undefined, 42);
  assert.match(f.calls.filter(c => c.sql.includes('SELECT id,state')).at(-1)!.sql, /ORDER BY id ASC/);
});
test('owner validation uses a writable transaction for the row lock and releases it', async () => {
  const f = fixture(sql => sql.includes('SELECT epoch') ? [{ epoch: 3 }] : []);
  await f.store.owned('owner', 3, 0);
  assert.equal(f.calls[0].sql, 'BEGIN READ WRITE'); assert.ok(f.calls[1].sql.includes('FOR SHARE'));
  assert.deepEqual(f.calls[1].values, ['owner', 3]); assert.equal(f.releases(), 1);
});
test('lost ownership rolls back before task or event writes', async () => {
  const f = fixture(); await assert.rejects(f.store.save({ id: 'x', version: 1 } as any,
    { at: 1, source: 'наш код', code: 'step', message: 'test' }, 'old', 2), { code: 'automation_owner_lost' });
  assert.equal(f.calls.at(-1)?.sql, 'ROLLBACK'); assert.ok(!f.calls.some(c => /UPDATE|INSERT/.test(c.sql)));
});
test('task checkpoint and log share one transaction with optimistic version validation', async () => {
  const f = fixture(sql => /SELECT epoch/.test(sql) ? [{ epoch: 1 }] : /UPDATE linkedin_automation.tasks/.test(sql) ? [{ id: 'x' }] : []);
  const saved = await f.store.save({ id: 'x', version: 4 } as any,
    { at: 1, source: 'наш код', code: 'step', message: 'test' }, 'owner', 1);
  assert.equal(saved.version, 5);
  const update = f.calls.find(c => c.sql.includes('UPDATE linkedin_automation.tasks'))!;
  assert.deepEqual([update.values[0], update.values[1], update.values[3]], ['x', 5, 4]);
  assert.ok(f.calls.findIndex(c => c.sql.includes('INSERT INTO linkedin_automation.events')) < f.calls.findIndex(c => c.sql === 'COMMIT'));
});
test('event failure rolls back the preceding checkpoint', async () => {
  const f = fixture(sql => {
    if (sql.includes('INSERT INTO linkedin_automation.events')) throw Error('SQL failure');
    return /SELECT epoch|UPDATE linkedin_automation.tasks/.test(sql) ? [{ id: 'x', epoch: 1 }] : [];
  });
  await assert.rejects(f.store.save({ id: 'x', version: 0 } as any,
    { at: 0, source: 'наш код', code: 'step', message: 'test' }, 'o', 1));
  assert.equal(f.calls.at(-1)?.sql, 'ROLLBACK'); assert.ok(!f.calls.some(c => c.sql === 'COMMIT'));
});
test('same withdrawal file imports once despite JSONB key ordering; a conflict is rejected', async () => {
  const value = { accountId: 'u', attempted: ['1'] };
  const f = fixture(sql => sql.startsWith('SELECT state FROM linkedin_automation.withdrawals')
    ? [{ state: { attempted: ['1'], accountId: 'u' } }] : []);
  await f.store.importWithdrawal(1, value);
  assert.ok(!f.calls.some(c => c.sql.startsWith('INSERT INTO linkedin_automation.withdrawals')));
  await assert.rejects(f.store.importWithdrawal(1, { ...value, attempted: [] }), { code: 'automation_withdrawal_import_conflict' });
});
test('cooldowns keep the greatest deadline; cleanup deletes only detailed events', async () => {
  const f = fixture(); await f.store.cooldown({ account: 'u', method: '*', until: 100, observedAt: 1, code: 'limit' });
  assert.ok(f.calls.some(c => c.sql.includes('GREATEST')));
  await f.store.pruneLogs(1);
  assert.deepEqual(f.calls.filter(c => /DELETE/.test(c.sql)).map(c => c.sql), ['DELETE FROM linkedin_automation.events WHERE at<to_timestamp($1/1000.0)']);
});

test('local action handoff excludes provider cooldown; external requests still include it', async () => {
  const f = fixture(); await f.store.blockedUntil('u', 'action', 100);
  await f.store.blockedUntil('u', '*', 100);
  const calls = f.calls.filter(c => c.sql.includes('max(until_at)'));
  assert.equal(calls.length, 2);
  for (const query of calls) {
    assert.match(query.sql, /method=\$2 OR \(\$2<>'action' AND method='\*'\)/);
    assert.match(query.sql, /account_key IN \(\$1,'\*'\)/);
  }
  assert.equal(calls[0].values[1], 'action'); assert.equal(calls[1].values[1], '*');
});
test('migration keeps all feature records untouched and is explicitly transactional', async () => {
  const sql = await readFile(new URL('./linkedin-automation.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes('BEGIN;') && sql.includes('COMMIT;'));
  assert.ok(!/DROP|TRUNCATE|DELETE FROM|ALTER TABLE/i.test(sql));
  assert.ok(sql.includes('account_key text NOT NULL UNIQUE'));
});
