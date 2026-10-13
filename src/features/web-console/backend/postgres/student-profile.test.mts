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
import { workflowFixture } from './workflow-fixture.mts';
import { tableIds } from './tables.mts';
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
        for (const match of sql.matchAll(/(middle_name|no_higher_education|current_company|previous_companies|education_entries|education)=\$(\d+)/g))
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
    birthDate: '', education: String(rows.get(id)?.education ?? ''), educationEntries: JSON.parse(String(rows.get(id)?.education_entries ?? '[]')), stopListCompany: '', calendarEmail: '', googleFolder: '',
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
  await f.repo.updateClientProfile(7, { middleName: 'Updated' });
  assert.equal(f.row.middle_name, 'Updated'); assert.equal(f.row.no_higher_education, true);
  const writes = f.calls.filter(c => c.sql.startsWith('UPDATE')).length;
  await f.repo.updateClientProfile(7, { firstName: 'Changed', middleName: undefined });
  assert.equal(f.calls.filter(c => c.sql.startsWith('UPDATE')).length, writes);
  await assert.rejects(f.repo.updateClientProfile(7, { noHigherEducation: true }), { code: 'invalid_student_education' });
  assert.equal(f.row.education, 'Old education');
  assert.ok(f.baseWrites.every(({ patch }) => !Object.hasOwn(patch, 'currentCompany') && !Object.hasOwn(patch, 'noHigherEducation')));
});

const otherEntry = { uni: 'Колледж связи', faculty: '', grade: '', yearOfEnd: '2020', city: 'Москва' };
const higherEntry = { uni: 'University', faculty: 'CS', grade: 'Bachelor', yearOfEnd: '2020' };

for (const mode of ['sql', 'legacy'] as const) test(`${mode}: actual dashboard mapping retains other education city`, async () => {
  const f = workflowFixture();
  await f.db.patchRecord(tableIds.clients, ['7'], { education_entries: JSON.stringify([otherEntry]), education: 'Stale' });
  const saved = await f[mode].getClientDashboard(7);
  assert.deepEqual(saved.client.educationEntries, [otherEntry]);
  assert.equal(saved.client.education, 'Колледж связи, 2020, Москва');
});

test('other education and flag save together and survive repeated reads without mutating input', async () => {
  const f = fixture(); f.row.no_higher_education = false;
  const input = { firstName: 'Updated', noHigherEducation: true, education: 'Stale summary', educationEntries: [otherEntry] };
  for (let attempt = 0; attempt < 2; attempt++) {
    const saved = await f.repo.updateClientProfile(7, input);
    assert.equal(saved.client.noHigherEducation, true);
    assert.deepEqual(saved.client.educationEntries, [otherEntry]);
    assert.equal(saved.client.education, 'Колледж связи, 2020, Москва');
    assert.deepEqual(studentProfileDraft(saved.client).educationEntries, [otherEntry]);
  }
  assert.ok(f.baseWrites.every(({ patch }) => !Object.hasOwn(patch, 'education') && !Object.hasOwn(patch, 'educationEntries')));
  const updates = f.calls.filter(c => c.sql.startsWith('UPDATE'));
  assert.equal(updates.length, 2);
  assert.ok(updates.every(c => /no_higher_education=\$\d/.test(c.sql) && /education_entries=\$\d/.test(c.sql) && /education=\$\d/.test(c.sql)));
  assert.equal(input.education, 'Stale summary');
});

test('invalid other education is rejected before any writes, including partial patches', async () => {
  for (const field of ['uni', 'yearOfEnd', 'city']) {
    const f = fixture(), before = { ...f.row };
    await assert.rejects(f.repo.updateClientProfile(7, { firstName: 'Changed', noHigherEducation: true,
      educationEntries: [{ ...otherEntry, [field]: '' }] }), { code: 'invalid_student_education' });
    assert.deepEqual(f.row, before); assert.deepEqual(f.baseWrites, []);
    assert.equal(f.calls.filter(c => c.sql.startsWith('UPDATE')).length, 0);
  }
  const f = fixture();
  await assert.rejects(f.repo.updateClientProfile(7, { educationEntries: [higherEntry] }), { code: 'invalid_student_education' });
  await f.repo.updateClientProfile(7, { firstName: 'Unrelated edit' });
  assert.equal(f.row.education, 'Old education');
});

test('failed education write leaves flag and previous education together and is not retried', async () => {
  for (const noHigherEducation of [true, false]) {
    const f = fixture(), before = { ...f.row }; f.setFailure();
    await assert.rejects(f.repo.updateClientProfile(7, { noHigherEducation,
      educationEntries: [noHigherEducation ? otherEntry : higherEntry] }), { code: 'postgres_write_failed' });
    assert.deepEqual(f.row, before);
    assert.ok(f.baseWrites.every(({ patch }) => !Object.hasOwn(patch, 'educationEntries')));
    assert.equal(f.calls.filter(c => c.sql.startsWith('UPDATE')).length, 1);
    assert.ok(f.calls.some(c => c.sql === 'ROLLBACK'));
  }
});

test('form payload round trip retains other education and city', async () => {
  const f = fixture();
  const profile = validateStudentProfile({ noHigherEducation: true, educationEntries: [otherEntry],
    firstName: 'Кира', lastName: 'Самсонова', birthDate: '2000-04-20', englishLevelId: 1,
    readyForInterviewInEnglishIn2Months: 'No', realLocation: 'Moscow, Russia', desiredLocation: 'Remote',
    calendarEmail: 'test@gmail.com', telegramPersonalChatId: '@test_student', workPlaces: []
  }, { today: '2026-10-05', englishLevelIds: [1] });
  assert.equal(profile.valid, true);
  await f.repo.updateClientProfile(7, JSON.parse(JSON.stringify(studentProfileSavePayload(profile.value))));
  assert.deepEqual(studentProfileDraft((await f.repo.getClientDashboard(7)).client).educationEntries, [otherEntry]);
});

test('switching back to higher education needs no city and removes an old city atomically', async () => {
  const f = fixture();
  await f.repo.updateClientProfile(7, { noHigherEducation: false, educationEntries: [{ ...higherEntry, city: 'Old city' }] });
  const saved = (await f.repo.getClientDashboard(7)).client;
  assert.equal(saved.noHigherEducation, false); assert.deepEqual(saved.educationEntries, [higherEntry]);
  assert.deepEqual(f.baseWrites, [{ id: 7, patch: {} }]);
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
