import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkedInFixture } from './linkedin-fixture.mts';
import { createSqlLinkedInStorage } from './linkedin-repository.mts';
import { linkedInRecords } from './linkedin-records.mts';
import { tableIds as t } from './tables.mts';
test('SQL account selection, readiness, stacks and target equal the Noco repository', async () => {
  const f = linkedInFixture(), sql = createSqlLinkedInStorage(f.db, f.grant).repository, old = f.legacy.repository;
  await sql.assertSchema();
  assert.deepEqual(await sql.listAccounts(), await old.listAccounts());
  assert.deepEqual(await sql.listStacks(), await old.listStacks());
  assert.deepEqual(await sql.resolveTarget('SQL fixture', 21), await old.resolveTarget('SQL fixture', 21));
  assert.deepEqual(await sql.getAccount(21, { fresh: true }), await old.getAccount(21, { fresh: true }));
  assert.equal(await sql.getAccount(999), undefined);
});
test('missing and ambiguous students/profiles, invalid URL and lost owner preserve domain errors', async () => {
  for (const change of ['missing', 'duplicate', 'profile', 'url', 'owner']) {
    const f = linkedInFixture();
    if (change === 'missing') f.rows.get(t.clients)!.delete('7');
    if (change === 'duplicate') f.set(t.clients, 8, { client_name: 'SQL fixture' });
    if (change === 'profile') f.set(t.profiles, 32, { clients_id: 7, locale: 'En', dolphin_profile_id: '7002' });
    if (change === 'url') f.rows.get(t.accounts)!.get('21')!.url = 'invalid';
    if (change === 'owner') f.rows.get(t.accounts)!.get('21')!.clients_id = 999;
    const sql = createSqlLinkedInStorage(f.db).repository;
    const outcome = async (fn: () => Promise<unknown>) => { try { return await fn(); } catch (e) { return (e as { code: string }).code; } };
    assert.deepEqual(await sql.listAccounts(), await f.legacy.repository.listAccounts(), change);
    assert.deepEqual(await outcome(() => sql.resolveTarget('SQL fixture', 21)),
      await outcome(() => f.legacy.repository.resolveTarget('SQL fixture', 21)), change);
  }
});
test('URL, stack, success and failure use the same fields, preserving fresh readback', async () => {
  const f = linkedInFixture(), g = linkedInFixture(), sql = createSqlLinkedInStorage(f.db, f.grant).repository;
  for (const repo of [sql, g.legacy.repository]) {
    await repo.listAccounts();
    await repo.updateLinkedInUrl(21, 'https://linkedin.com/in/new-test');
    assert.deepEqual(await repo.updatePrimaryStack(7, 2), { id: 2, name: 'Python' });
    await repo.recordSuccess(21, { accountId: 'fake', accountStatus: 'running', providerId: 'provider',
      profileUrl: 'https://www.linkedin.com/in/new-test/', profileName: 'Тест', now: () => new Date('2026-09-02Z') });
    await repo.recordFailure(21, { errorCode: 'unipile_timeout', now: () => new Date('2026-09-03Z') });
  }
  const actual = (await sql.getAccount(21, { fresh: true }))!;
  const expected = (await g.legacy.repository.getAccount(21, { fresh: true }))!;
  for (const key of ['lastVerifiedAt', 'authUpdatedAt'] as const) expected[key] = expected[key]?.replace('T', ' ');
  assert.deepEqual(actual, expected); assert.equal(actual.primaryStack, 'Python');
  assert.equal((await sql.listAccounts())[0].primaryStack, 'Python');
  f.failRead(); await assert.rejects(sql.getAccount(21, { fresh: true })); f.failRead(false);
  assert.ok(await sql.getAccount(21, { fresh: true }));
});
test('missing table/column/relation blocks the SQL adapter without fallback', () => {
  for (const change of ['table', 'column', 'relation']) {
    const f = linkedInFixture(), tables = f.db.listTables();
    if (change === 'table') tables.splice(tables.findIndex(t => t.title === 'linkedin_auth_runs'), 1);
    if (change === 'column') {
      const columns = tables.find(v => v.id === t.accounts)!.columns;
      columns.splice(columns.findIndex(c => c.title === 'url'), 1);
    }
    if (change === 'relation') tables.find(v => v.id === t.clients)!.columns.find(c => c.title === 'rel_clients_primary_stack')!.colOptions!.type = 'mm';
    assert.throws(() => createSqlLinkedInStorage(f.db), { code: change === 'table' ? 'sql_linkedin_history_table_required'
      : change === 'column' ? 'sql_linkedin_columns_required' : 'sql_linkedin_relation_required' }, change);
  }
});
test('SQL reading paginates fully, preserves NULL/empty/Unicode and sees changed physical fields', async () => {
  const f = linkedInFixture();
  for (let i = 50; i < 155; i++) f.set(t.stacks, i, { name: `Язык ${i}`, description: i % 2 ? null : '' });
  const list = f.db.listRecords; let calls = 0;
  f.db.listRecords = async (id, options) => {
    calls++; const rows = (await list(id)).records.sort((a,b) => Number(a.key[0])-Number(b.key[0]));
    const next = rows.filter(r => !options?.after || Number(r.key[0]) > Number(options.after[0]));
    const records = next.slice(0, 20); return { records, nextKey: next.length > 20 ? records.at(-1)!.key : null };
  };
  const reads = linkedInRecords(f.db), rows = await reads.fetchRecords(t.stacks);
  assert.equal(rows.length, 107); assert.ok(calls > 1); assert.equal(rows.find(r => r.Id === 50)!.description, '');
  assert.equal(rows.find(r => r.Id === 51)!.description, null);
  f.set(t.stacks, 1, { name: 'Changed SQL column' });
  assert.equal((await reads.fetchRecords(t.stacks, 1, { where: '(Id,eq,1)' }))[0].name, 'Changed SQL column');
});
test('stack write failure preserves the domain error without retrying SQL', async () => {
  for (const source of ['noco', 'sql']) {
    const f = linkedInFixture(), repo = source === 'noco' ? f.legacy.repository : createSqlLinkedInStorage(f.db, f.grant).repository;
    f.failWrite();
    await assert.rejects(repo.updatePrimaryStack(7, 2), { code: 'noco_stack_update_failed' });
    assert.equal(f.count(), 1);
  }
});
