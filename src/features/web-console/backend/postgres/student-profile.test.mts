import test from 'node:test';
import assert from 'node:assert/strict';
import { studentProfileStore } from './student-profile-store.mts';
import { withStudentProfile } from './student-profile-repository.mts';
import { COPY_MARKER } from '../../../../integrations/postgres/contracts.mts';
import type { SqlPool } from '../../../../integrations/postgres/contracts.mts';
import type { ClientDashboard, ClientProfilePatch, WebConsoleRepository } from '../types.ts';
import { openSqlConsole } from './runtime.mts';
import { runtimeFixture } from './runtime-fixture.mts';

function fixture() {
  const row: Record<string, unknown> = { id: 7, middle_name: 'Initial', no_higher_education: true,
    current_company: 'Alpha', previous_companies: 'Beta', education: 'Old education' };
  const calls: { sql: string; values: unknown[] }[] = [];
  let fail = false;
  const pool: SqlPool = { async end() {}, async connect() {
    return { release() {}, async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('current_database()')) return { rows: [{ database: 'unicorn_noco_copy_restore', marker: COPY_MARKER }] };
      if (sql.includes('FROM noco.clients')) return { rows: [{ ...row }] };
      if (sql.startsWith('UPDATE')) {
        if (fail) throw Error('private SQL diagnostic');
        for (const match of sql.matchAll(/(middle_name|no_higher_education|current_company|previous_companies)=\$(\d+)/g))
          row[match[1]] = values[Number(match[2]) - 1];
        if (sql.includes('education=NULL')) row.education = null;
        return { rows: [{ id: 7 }] };
      }
      return { rows: [] };
    } };
  } };
  const store = studentProfileStore(pool, 'unicorn_noco_copy_restore');
  const baseWrites: { id: number; patch: ClientProfilePatch }[] = [];
  const dashboard = (id: number): ClientDashboard => ({ client: { id, clientName: '', firstName: '', lastName: '', fio: '',
    birthDate: '', education: '', educationEntries: [], stopListCompany: '', calendarEmail: '', googleFolder: '',
    telegramPersonalChatId: '', commonChatId: '' }, platformAccounts: [], linkedInEmail: '' });
  const base = { async getClientDashboard(id: number) { return dashboard(id); },
    async updateClientProfile(id: number, patch: ClientProfilePatch) { baseWrites.push({ id, patch }); return dashboard(id); },
    async createPlatformAccount(id: number) { return dashboard(id); },
    async updatePlatformAccount(id: number) { return dashboard(id); },
    async deletePlatformAccount(id: number) { return dashboard(id); }
  } as unknown as WebConsoleRepository;
  return { row, calls, base, baseWrites, store, repo: withStudentProfile(base, store, 7), setFailure() { fail = true; } };
}

test('SQL pilot: company moves/clearing and partial saves preserve unrelated fields', async () => {
  const f = fixture();
  await f.repo.updateClientProfile(7, { currentCompany: 'Alpha,Gamma', previousCompanies: 'Beta,Delta', stopListCompany: 'Alpha,Gamma,Beta,Delta' });
  assert.equal(f.row.current_company, 'Alpha,Gamma');
  await f.repo.updateClientProfile(7, { currentCompany: 'Beta', previousCompanies: 'Alpha,Gamma,Delta' });
  const loaded = await f.repo.getClientDashboard(7);
  assert.equal(loaded.client.currentCompany, 'Beta');
  assert.equal(loaded.client.previousCompanies, 'Alpha,Gamma,Delta');
  assert.equal(loaded.client.studentProfileEnabled, true);
  await f.repo.updateClientProfile(7, { currentCompany: '', previousCompanies: '' });
  assert.equal(f.row.current_company, null); assert.equal(f.row.previous_companies, null);
  assert.equal(f.row.middle_name, 'Initial'); assert.equal(f.row.no_higher_education, true);
  await f.repo.updateClientProfile(7, { middleName: 'Updated', noHigherEducation: false });
  assert.equal(f.row.middle_name, 'Updated'); assert.equal(f.row.no_higher_education, false);
  const writes = f.calls.filter(c => c.sql.startsWith('UPDATE')).length;
  await f.repo.updateClientProfile(7, { firstName: 'Changed', middleName: undefined });
  assert.equal(f.calls.filter(c => c.sql.startsWith('UPDATE')).length, writes);
  await f.repo.updateClientProfile(7, { noHigherEducation: true });
  assert.equal(f.row.education, null);
  assert.ok(f.baseWrites.every(({ patch }) => !Object.hasOwn(patch, 'currentCompany') && !Object.hasOwn(patch, 'noHigherEducation')));
});

test('other clients keep editing through the base repository; account responses retain pilot fields', async () => {
  const f = fixture();
  await f.repo.updateClientProfile(8, { firstName: 'Other', currentCompany: 'Ignored' });
  assert.deepEqual(f.baseWrites, [{ id: 8, patch: { firstName: 'Other' } }]);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.repo.getClientDashboard(8)).client.studentProfileEnabled, undefined);
  for (const result of [await f.repo.createPlatformAccount(7, {}), await f.repo.updatePlatformAccount(7, 1, {}), await f.repo.deletePlatformAccount(7, 1)])
    assert.equal(result.client.currentCompany, 'Alpha');
});

test('failed base save never writes extensions; SQL failures are sanitized and not retried', async () => {
  const f = fixture();
  const denied = withStudentProfile({ ...f.base, async updateClientProfile() { throw Error('forbidden'); } }, f.store, 7);
  await assert.rejects(denied.updateClientProfile(7, { currentCompany: 'X' }), /forbidden/);
  assert.equal(f.calls.length, 0);
  f.setFailure();
  await assert.rejects(f.repo.updateClientProfile(7, { currentCompany: 'X' }), { code: 'postgres_write_failed' });
  assert.equal(f.calls.filter(c => c.sql.startsWith('UPDATE')).length, 1);
  assert.ok(f.calls.some(c => c.sql === 'ROLLBACK'));
});

test('pilot startup is opt-in, verifies the selected email and schema, and never performs writes', async () => {
  const off = runtimeFixture();
  const disabled = await openSqlConsole(off.env, () => off.pool); await disabled.close();
  assert.ok(!off.calls.some(sql => sql.includes('middle_name')));
  const mismatch = runtimeFixture();
  await assert.rejects(openSqlConsole({ ...mismatch.env, STUDENT_PROFILE_TEST_CLIENT_ID: '7' }, () => mismatch.pool),
    { code: 'student_profile_pilot_mismatch' });
  assert.equal(mismatch.state.ends, 1);
  assert.ok(mismatch.calls.some(sql => sql.includes('lower(trim(calendar_email))=$2')));
  assert.ok(!mismatch.calls.some(sql => /INSERT|UPDATE|ALTER/.test(sql)));
});
