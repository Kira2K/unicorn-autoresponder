import assert from 'node:assert/strict';
import { createProfileFillerNocoRepository } from '../noco-repository.ts';
import { createProfileFillerRepository } from '../repository.ts';
import { createProfileFillerPostgresSource } from '../postgres-source.mts';
import { makeHhFixture } from './postgres-fixture.mts';
import { TABLES } from '../../../platform/db/postgres/test-fixture.mts';

export async function runPostgresRepositoryTests() {
  const f = makeHhFixture(), old = createProfileFillerNocoRepository(f.records);
  const sql = createProfileFillerRepository('postgres', async () => f.reader);
  for (const [id, market] of [[1, 'En'], [2, 'Ru']] as const)
    assert.deepEqual(await sql.resolveClient(id, market), await old.resolveClient(id, market));
  assert.equal((await sql.resolveClient(1, 'En')).cvRevision, '2026-09-06 12:00:00+00:00');
  assert.equal((await sql.resolveClient(1, 'En')).contacts.telegram, '@fake');
  assert.equal((await sql.resolveClient(1, 'En')).fallbacks.englishLevel, 'B2');
  assert.equal((await sql.resolveClient(2, 'Ru')).cvRevision, '22');
  const reads = f.requests.length;
  await sql.resolveClient(1, 'En'); assert.equal(f.requests.length, reads);
  f.data.cvProcessing[1].en_version_url = 'fake-updated';
  f.data.cvProcessing[1].UpdatedAt = '2026-09-07T01:02:03.123+00:00';
  await sql.snapshot(true); await old.snapshot(true);
  assert.deepEqual(await sql.resolveClient(1, 'En'), await old.resolveClient(1, 'En'));
  assert.equal((await sql.resolveClient(1, 'En')).cvUrl, 'fake-updated');

  const cases: Array<(f: ReturnType<typeof makeHhFixture>) => void> = [
    x => { x.data.clients = []; }, x => { x.data.clients[0].client_status = 'on ru market'; },
    x => { x.data.clients[0].stacks_id = null; }, x => { x.data.dolphinProfiles = []; },
    x => { x.data.dolphinProfiles.push({ ...x.data.dolphinProfiles[1], Id: 99 }); },
    x => { x.data.dolphinProfiles[1].dolphin_profile_id = ''; }, x => { x.data.cvProcessing = []; },
    x => { x.data.platformAccounts.push({ ...x.data.platformAccounts[1], Id: 99 }); },
    x => { x.data.hhAutoresponses.push({ ...x.data.hhAutoresponses[0], Id: 98, stacks_id1: 3 },
      { ...x.data.hhAutoresponses[0], Id: 99, stacks_id1: 4 }); }
  ];
  for (const change of cases) {
    const fixture = makeHhFixture(); change(fixture);
    const observe = async (repository: typeof sql) => {
      try { return await repository.resolveClient(1, 'En'); }
      catch (e) { const error = e as Error & { code?: string; stage?: string; details?: unknown };
        return { code: error.code, stage: error.stage, message: error.message, details: error.details }; }
    };
    assert.deepEqual(await observe(createProfileFillerRepository('postgres', async () => fixture.reader)),
      await observe(createProfileFillerNocoRepository(fixture.records)));
  }
  const failure = new Error('sql_unavailable'); let fail = true;
  const recovering = createProfileFillerRepository(' PostgreS ', async () => { if (fail) throw failure; return f.reader; });
  await assert.rejects(recovering.listClients(), e => e === failure);
  await assert.rejects(recovering.resolveClient(1, 'En'), e => e === failure);
  fail = false; assert.equal((await recovering.resolveClient(1, 'En')).cvUrl, 'fake-updated');
  const source = createProfileFillerPostgresSource(async () => f.reader);
  await assert.rejects(source.fetchRecords('linkedin_manager'), /hh_profile_table_not_allowed/);
  f.tables.find(t => t.id === TABLES.clients.id)!.columns = f.tables.find(t => t.id === TABLES.clients.id)!.columns
    .filter(c => c.title !== 'English level');
  await assert.rejects(source.fetchRecords(TABLES.clients.id), /appdb_relation_required/);
}
