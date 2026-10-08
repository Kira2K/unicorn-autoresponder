import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { studentProfileStore } from './student-profile-store.mts';
import { withStudentProfile } from './student-profile-repository.mts';
import { COPY_MARKER } from '../../../../integrations/postgres/contracts.mts';
import type { SqlPool } from '../../../../integrations/postgres/contracts.mts';
import type { ClientDashboard, ClientProfilePatch, WebConsoleRepository } from '../types.ts';
import { openSqlConsole } from './runtime.mts';
import { runtimeFixture } from './runtime-fixture.mts';
import { validateStudentProfile } from '../../student-profile-validation.ts';
import type { StudentProfile } from '../../student-profile-validation.ts';
const { studentProfileDraft, studentProfileSavePayload } = createRequire(import.meta.url)(
  '../../frontend/src/student-profile-draft.js') as {
    studentProfileDraft(client: ClientDashboard['client']): Pick<StudentProfile, 'noHigherEducation' | 'educationEntries'>;
    studentProfileSavePayload(profile: StudentProfile): ClientProfilePatch;
  };

function fixture() {
  const row: Record<string, unknown> = { id: 7, middle_name: 'Initial', no_higher_education: true,
    current_company: 'Alpha', previous_companies: 'Beta', education: 'Old education',
    education_entries: '[{"uni":"Old university"}]' };
  const rows = new Map([[7, row], [8, { ...row, id: 8, current_company: 'Other company' }]]);
  const calls: { sql: string; values: unknown[] }[] = [];
  let fail = false;
  const pool: SqlPool = { async end() {}, async connect() {
    return { release() {}, async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('current_database()')) return { rows: [{ database: 'unicorn_noco_copy_restore', marker: COPY_MARKER }] };
      if (sql.includes('FROM noco.clients')) return { rows: sql.includes('LIMIT 0') ? [] : [{ ...rows.get(Number(values[0])) }] };
      if (sql.startsWith('UPDATE')) {
        if (fail) throw Error('private SQL diagnostic');
        const row = rows.get(Number(values[0]))!;
        for (const match of sql.matchAll(/(middle_name|no_higher_education|current_company|previous_companies)=\$(\d+)/g))
          row[match[1]] = values[Number(match[2]) - 1];
        if (sql.includes('education=NULL')) row.education = null;
        if (sql.includes('education_entries=NULL')) row.education_entries = null;
        return { rows: [{ id: Number(values[0]) }] };
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
  return { row, calls, base, baseWrites, store, repo: withStudentProfile(base, store), setFailure() { fail = true; } };
}

test('SQL profile: company moves/clearing and partial saves preserve unrelated fields', async () => {
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

test('education opt out clears both columns together with the flag, without an earlier base education write', async () => {
  const f = fixture();
  f.row.no_higher_education = false;
  const input = { firstName: 'Updated', noHigherEducation: true, education: 'Stale university',
    educationEntries: [{ uni: 'Stale university', faculty: 'CS', grade: 'Bachelor', yearOfEnd: '2020' }] };
  const saved = await f.repo.updateClientProfile(7, input);
  assert.deepEqual(f.baseWrites, [{ id: 7, patch: { firstName: 'Updated' } }]);
  assert.equal(f.row.education, null);
  assert.equal(f.row.education_entries, null);
  assert.equal(saved.client.noHigherEducation, true);
  const updates = f.calls.filter(c => c.sql.startsWith('UPDATE'));
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /no_higher_education=\$2,education=NULL,education_entries=NULL/);
  assert.deepEqual(updates[0].values, [7, true]);
  assert.equal(input.education, 'Stale university');
});

test('failed education opt out never sends education to the separate base save', async () => {
  const f = fixture();
  f.row.no_higher_education = false;
  const before = { ...f.row };
  f.setFailure();
  await assert.rejects(f.repo.updateClientProfile(7, {
    noHigherEducation: true, education: null, educationEntries: null
  }), { code: 'postgres_write_failed' });
  assert.deepEqual(f.baseWrites, [{ id: 7, patch: {} }]);
  assert.deepEqual(f.row, before);
  assert.ok(f.calls.some(c => c.sql === 'ROLLBACK'));
});

test('form payload round trip saves SQL NULL and preserves opt out on repeated saves and reads', async () => {
  const f = fixture();
  f.row.no_higher_education = false;
  const profile = validateStudentProfile({ noHigherEducation: true,
    educationEntries: [{ uni: 'Old university', faculty: 'CS', grade: 'Bachelor', yearOfEnd: '2020' }],
    firstName: 'Кира', lastName: 'Самсонова', birthDate: '2000-04-20', englishLevelId: 1,
    readyForInterviewInEnglishIn2Months: 'No', realLocation: 'Moscow, Russia', desiredLocation: 'Remote',
    calendarEmail: 'test@gmail.com', telegramPersonalChatId: '@test_student', workPlaces: []
  }, { today: '2026-10-05', englishLevelIds: [1] });
  assert.equal(profile.valid, true);
  const payload = JSON.parse(JSON.stringify(studentProfileSavePayload(profile.value)));
  for (let attempt = 0; attempt < 2; attempt++) {
    await f.repo.updateClientProfile(7, payload);
    assert.equal(f.row.no_higher_education, true);
    assert.equal(f.row.education, null);
    assert.equal(f.row.education_entries, null);
    const draft = studentProfileDraft((await f.repo.getClientDashboard(7)).client);
    assert.equal(draft.noHigherEducation, true);
    assert.deepEqual(draft.educationEntries, [{ uni: '', faculty: '', grade: '', yearOfEnd: '' }]);
  }
  assert.ok(f.baseWrites.every(({ patch }) => !Object.hasOwn(patch, 'education') && !Object.hasOwn(patch, 'educationEntries')));
  assert.ok(f.calls.some(c => c.sql === 'COMMIT'));
});

test('education remains editable when opting back in', async () => {
  const f = fixture();
  const educationEntries = [{ uni: 'University', faculty: 'CS', grade: 'Bachelor', yearOfEnd: '2020' }];
  await f.repo.updateClientProfile(7, { noHigherEducation: false, educationEntries });
  assert.deepEqual(f.baseWrites, [{ id: 7, patch: { educationEntries } }]);
  assert.equal((await f.repo.getClientDashboard(7)).client.noHigherEducation, false);
  assert.ok(!f.calls.some(c => c.sql.includes('education=NULL')));
});

test('every client can save extensions without changing another client; account responses retain their own fields', async () => {
  const f = fixture();
  await f.repo.updateClientProfile(8, { firstName: 'Other', currentCompany: 'Updated company' });
  assert.deepEqual(f.baseWrites, [{ id: 8, patch: { firstName: 'Other' } }]);
  assert.equal((await f.repo.getClientDashboard(8)).client.studentProfileEnabled, true);
  assert.equal((await f.repo.getClientDashboard(8)).client.currentCompany, 'Updated company');
  assert.equal((await f.repo.getClientDashboard(7)).client.currentCompany, 'Alpha');
  for (const id of [7, 8]) for (const result of [await f.repo.createPlatformAccount(id, {}), await f.repo.updatePlatformAccount(id, 1, {}), await f.repo.deletePlatformAccount(id, 1)])
    assert.equal(result.client.currentCompany, id === 7 ? 'Alpha' : 'Updated company');
});

test('failed base save never writes extensions; SQL failures are sanitized and not retried', async () => {
  const f = fixture();
  const denied = withStudentProfile({ ...f.base, async updateClientProfile() { throw Error('forbidden'); } }, f.store);
  await assert.rejects(denied.updateClientProfile(7, { currentCompany: 'X' }), /forbidden/);
  assert.equal(f.calls.length, 0);
  f.setFailure();
  await assert.rejects(f.repo.updateClientProfile(7, { currentCompany: 'X' }), { code: 'postgres_write_failed' });
  assert.equal(f.calls.filter(c => c.sql.startsWith('UPDATE')).length, 1);
  assert.ok(f.calls.some(c => c.sql === 'ROLLBACK'));
});

test('startup enables profiles without personal flags, checks the schema even on an empty database, and never writes', async () => {
  const f = runtimeFixture();
  const runtime = await openSqlConsole(f.env, () => f.pool); await runtime.close();
  assert.ok(f.calls.some(sql => sql.includes('middle_name') && sql.includes('LIMIT 0')));
  assert.ok(!f.calls.some(sql => /calendar_email|INSERT|UPDATE|ALTER/.test(sql)));
  const missing = runtimeFixture(), connect = missing.pool.connect;
  missing.pool.connect = async () => {
    const session = await connect(), query = session.query;
    session.query = async (sql, values) => {
      if (sql.includes('middle_name')) throw Error('column does not exist');
      return query(sql, values);
    };
    return session;
  };
  await assert.rejects(openSqlConsole(missing.env, () => missing.pool), { code: 'postgres_read_failed' });
  assert.equal(missing.state.ends, 1);
});
