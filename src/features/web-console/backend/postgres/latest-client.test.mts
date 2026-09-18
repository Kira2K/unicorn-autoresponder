import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowFixture } from './workflow-fixture.mts';
import { tableIds as t } from './tables.mts';
import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
import { serviceHttpFixture } from './service-http-fixture.mts';

test('latest dashboard selects numeric ID across pages and hydrates only its student', async () => {
  const f = workflowFixture(), base = { ...f.rows.get(t.clients)!.get('7')! };
  f.rows.get(t.clients)!.clear();
  for (let id = 501; id >= 1; id--) f.set(t.clients, id, { ...base, Id: id,
    client_name: `Ученик ${id}`, nc_order: String(502 - id), google_folder: id === 501 ? '' : null });
  f.set(t.accounts, 99, { clients_id: 501, platforms_id: 16, login: 'latest',
    password: 'fixture-password', email_password: 'fixture-email-password' });
  const before = structuredClone(f.rows), list = f.db.listRecords.bind(f.db);
  let pages = 0; const hydrated: string[] = [];
  f.db.listRecords = async (id, options) => {
    const result = await list(id, options); if (id !== t.clients) return result;
    pages++; const start = options?.after ? result.records.findIndex(r => r.key[0] === options.after![0]) + 1 : 0;
    const records = result.records.slice(start, start + (options?.limit ?? 100));
    return { records, nextKey: start + records.length < result.records.length ? records.at(-1)!.key : null };
  };
  f.db.listRelated = async (_id, _relation, key) => { hydrated.push(key[0]); return { records: [], nextKey: null }; };
  for (const options of [undefined, { fullAccess: true }]) {
    pages = 0; hydrated.length = 0;
    assert.deepEqual(await f.sql.getLatestClientDashboard(options), await f.legacy.getLatestClientDashboard(options));
    assert.equal(pages, 6); assert.equal(hydrated.length, 1); assert.deepEqual(hydrated, ['501']);
  }
  const masked = await f.sql.getLatestClientDashboard(), full = await f.sql.getLatestClientDashboard({ fullAccess: true });
  assert.equal(masked.platformAccounts.length, 1); assert.equal(masked.platformAccounts[0].password, '***');
  assert.equal(full.platformAccounts[0].password, 'fixture-password');
  assert.equal(full.platformAccounts[0].emailPassword, 'fixture-email-password');
  assert.deepEqual(f.rows, before); assert.equal(f.count(), 0);
});

test('latest dashboard preserves complete mentor pages and reads updated fields without a cache', async () => {
  const f = workflowFixture(); let pages = 0;
  f.db.listRelated = async (_id, _key, _relation, options) => {
    pages++; const last = Boolean(options?.after);
    return { records: [{ key: [last ? '2' : '1'], data: { Id: last ? 2 : 1, name: last ? 'Б' : 'А' }, sourceJson: '' }],
      nextKey: last ? null : ['1'] };
  };
  const direct = await f.sql.getClientDashboard(7); pages = 0;
  assert.deepEqual(await f.sql.getLatestClientDashboard(), direct); assert.equal(pages, 2);
  assert.deepEqual(direct.client.mentors, ['А', 'Б']);
  f.rows.get(t.clients)!.get('7')!.client_name = 'Изменено';
  assert.equal((await f.sql.getLatestClientDashboard()).client.clientName, 'Изменено');
  assert.equal(f.count(), 0);
});

test('empty database retains the existing error', async () => {
  const f = workflowFixture(); f.rows.get(t.clients)!.clear();
  await assert.rejects(f.legacy.getLatestClientDashboard(), { message: 'No clients found' });
  await assert.rejects(f.sql.getLatestClientDashboard(), { message: 'No clients found' });
  assert.equal(f.count(), 0);
});

test('SQL failure at selection or hydration propagates without fallback or writes; next read can succeed', async () => {
  const f = workflowFixture(), get = f.db.getRecord.bind(f.db);
  const error = new PostgresReadError('postgres_read_unavailable');
  const expected = { code: error.code, response: { status: 503 } };
  f.failRead(true, error); await assert.rejects(f.sql.getLatestClientDashboard(), expected);
  f.failRead(false); f.db.getRecord = async () => { throw error; };
  await assert.rejects(f.sql.getLatestClientDashboard(), expected);
  f.db.getRecord = get;
  assert.deepEqual(await f.sql.getLatestClientDashboard(), await f.legacy.getLatestClientDashboard());
  assert.equal(f.count(), 0);
});

test('latest dashboard endpoint keeps authorization, complete admin response and SQL error status', async () => {
  const f = workflowFixture(), server = await serviceHttpFixture(f.sql, {});
  try {
    assert.equal((await server.request('/api/admin/latest-client')).status, 401);
    await server.login();
    const response = await server.request('/api/admin/latest-client'); assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), JSON.parse(JSON.stringify(await f.legacy.getLatestClientDashboard({ fullAccess: true }))));
    f.failRead(true, new PostgresReadError('postgres_read_unavailable'));
    assert.equal((await server.request('/api/admin/latest-client')).status, 503);
    assert.equal(f.count(), 0);
  } finally { await server.close(); }
});
