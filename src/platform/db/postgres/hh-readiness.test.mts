import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { hhReadinessOptions } from './hh-readiness.mts';
import { createPostgresAppDb } from './postgres-db.mts';
import { makeFixture, unusedSheets } from './test-fixture.mts';
import type { AppDb, Market } from '../types.ts';
const require = createRequire(import.meta.url);
const { createNocoDb } = require('../noco/noco-db.ts') as { createNocoDb(options: unknown): AppDb };
const { loadReadinessResults } = require('../../../integrations/noco/hh-response-readiness/index.ts') as {
  loadReadinessResults(options: { market?: Market; clientNames?: string[]; db: AppDb;
    nocoClient: { fetchRecords(id: string): Promise<unknown[]> } }): Promise<unknown[]>;
};
test('HH readiness keeps old defaults except explicit postgres; no hidden SQL fallback', async () => {
  const f = makeFixture(), db = createPostgresAppDb(async () => f.reader, unusedSheets);
  for (const mode of [undefined, '', 'sheets', 'noco', 'unknown'])
    assert.deepEqual(hhReadinessOptions(mode, db, async () => { throw new Error('unexpected_sql'); }), {});
  const options = hhReadinessOptions(' PostgreS ', db, async () => f.reader);
  assert.equal(options.db, db); assert.ok(options.nocoClient);
  const failure = new Error('sql_offline');
  await assert.rejects(loadReadinessResults({ db, ...hhReadinessOptions('postgres', db, async () => { throw failure; }) } as
    Parameters<typeof loadReadinessResults>[0]), e => e === failure);
});
test('HH readiness matches Noco for Ru/En, disabled targets, selections and missing relations', async () => {
  for (const modify of [(_f: ReturnType<typeof makeFixture>) => {},
    (f: ReturnType<typeof makeFixture>) => { f.data.dolphinProfiles = []; },
    (f: ReturnType<typeof makeFixture>) => { f.data.platformAccounts = []; },
    (f: ReturnType<typeof makeFixture>) => { f.data.stacks[0].hh_scenario_url_en = ''; },
    (f: ReturnType<typeof makeFixture>) => { f.data.hhAutoresponses[0].Делаем_отклики_En = false; }
  ]) {
    const f = makeFixture(); modify(f);
    for (const market of ['Ru', 'En'] as const) for (const clientNames of [undefined, ['Fake'], ['Missing']]) {
      const db = createPostgresAppDb(async () => f.reader, unusedSheets);
      const sql = await loadReadinessResults({ market, clientNames, db, ...hhReadinessOptions('postgres', db, async () => f.reader) } as
        Parameters<typeof loadReadinessResults>[0]);
      const old = await loadReadinessResults({ market, clientNames, db: createNocoDb({ nocoClient: f.records }), nocoClient: f.records });
      assert.deepEqual(sql, old);
    }
  }
});
