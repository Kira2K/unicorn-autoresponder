import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientIdRuntime } from './runtime.mts';

const wait = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise(r => setTimeout(r, 2));
  assert.ok(condition(), 'operation completed');
};

function fixture() {
  const rows = new Map([['1', { id: '1', username: '@alice_test', telegramId: '' }]]);
  const lookups: string[] = [], saved: string[] = [], reports: string[] = [];
  let notify: (id: string) => void, lost: () => void, subscriptions = 0;
  let resolve = async (username: string) => { lookups.push(username); return '9007199254740993'; };
  const runtime = createClientIdRuntime({
    store: {
      async pending(after) { return [...rows.values()].filter(r => !r.telegramId && BigInt(r.id) > BigInt(after)).map(r => r.id); },
      async get(id) { const row = rows.get(id); return row && !row.telegramId ? { id, username: row.username } : undefined; },
      async save(row, telegramId) { const current = rows.get(row.id); if (current && !current.telegramId && current.username === row.username) { current.telegramId = telegramId; saved.push(row.id); return true; } return false; }
    },
    async subscribe(onId, onLost) { subscriptions++; notify = onId; lost = onLost; return async () => {}; },
    resolve: name => resolve(name), report: event => reports.push(event.code),
    retryMs: 5, spacingMs: 1
  });
  return { runtime, rows, lookups, saved, reports, notify: (id: string) => notify(id), lost: () => lost(),
    subscriptions: () => subscriptions, resolver: (fn: typeof resolve) => { resolve = fn; } };
}

test('startup fills old rows; INSERT/UPDATE signals fill new rows; filled IDs stay unchanged', async () => {
  const f = fixture();
  try {
    await f.runtime.start(); await wait(() => f.saved.length === 1);
    assert.equal(f.rows.get('1')!.telegramId, '9007199254740993');
    f.notify('1'); f.rows.set('2', { id: '2', username: 'bob_test', telegramId: '' }); f.notify('2');
    await wait(() => f.saved.length === 2);
    assert.deepEqual(f.lookups, ['alice_test', 'bob_test']);
  } finally { await f.runtime.stop(); }
});

test('changing username or manually filling ID during lookup never overwrites current data', async () => {
  const f = fixture(); let finish!: (id: string) => void;
  f.resolver(async () => new Promise(r => { finish = r; }));
  try {
    await f.runtime.start(); await wait(() => !!finish);
    f.rows.get('1')!.username = '@changed_name'; f.rows.get('1')!.telegramId = '777';
    finish('888'); await wait(() => f.reports.includes('stale'));
    assert.equal(f.rows.get('1')!.telegramId, '777'); assert.deepEqual(f.saved, []);
  } finally { await f.runtime.stop(); }
});

test('temporary errors retry; absent usernames stop; reconnect recovers missed records', async () => {
  const f = fixture(); let attempts = 0;
  f.resolver(async () => { if (++attempts === 1) throw Object.assign(Error(), { code: 'temporary' }); return '888'; });
  try {
    await f.runtime.start(); await wait(() => f.saved.length === 1); assert.equal(attempts, 2);
    f.resolver(async () => { throw Object.assign(Error(), { code: 'not_found' }); });
    f.rows.set('2', { id: '2', username: '@missing_name', telegramId: '' }); f.notify('2');
    await wait(() => f.reports.includes('not_found'));
    f.rows.set('3', { id: '3', username: '@charlie_test', telegramId: '' });
    f.resolver(async () => '999'); f.lost();
    await wait(() => f.rows.get('3')!.telegramId === '999'); assert.equal(f.subscriptions(), 2);
  } finally { await f.runtime.stop(); }
});

test('rollback/no notification does no lookup; duplicate signals and stop do not create sends or timers', async () => {
  const f = fixture(); f.rows.clear();
  await f.runtime.start(); assert.deepEqual(f.lookups, []);
  f.rows.set('4', { id: '4', username: '@delta_test', telegramId: '' });
  f.notify('4'); f.notify('4'); f.notify('4'); await wait(() => f.saved.length === 1);
  await f.runtime.stop(); f.notify('4'); f.lost();
  assert.deepEqual(f.lookups, ['delta_test']); assert.equal(f.subscriptions(), 1);
});

test('username edited during lookup is resolved again, and only the new result is saved', async () => {
  const f = fixture(), seen: string[] = []; let finish!: (id: string) => void;
  f.resolver(async name => { seen.push(name); return seen.length === 1 ? new Promise(r => { finish = r; }) : '999'; });
  try {
    await f.runtime.start(); await wait(() => !!finish);
    f.rows.get('1')!.username = '@changed_user'; f.notify('1'); finish('888');
    await wait(() => f.saved.length === 1);
    assert.equal(f.rows.get('1')!.telegramId, '999'); assert.deepEqual(seen, ['alice_test', 'changed_user']);
  } finally { await f.runtime.stop(); }
});

test('Telegram flood wait pauses all lookups, including newly signaled clients', async () => {
  const f = fixture(), times: number[] = [];
  f.rows.set('2', { id: '2', username: '@other_user', telegramId: '' });
  f.resolver(async () => {
    times.push(Date.now());
    if (times.length === 1) throw Object.assign(Error(), { code: 'temporary', retryAfterMs: 50 });
    return '888';
  });
  try {
    await f.runtime.start(); await wait(() => times.length === 1); f.notify('2');
    await wait(() => f.saved.length === 2);
    assert.ok(times[1] - times[0] >= 50, 'no request before the mandatory Telegram pause expires');
  } finally { await f.runtime.stop(); }
});
