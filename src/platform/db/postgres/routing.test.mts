import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createPostgresAppDb } from './postgres-db.mts';
import type { AppDb } from '../types.ts';

test('AppDb changes only explicit postgres; default, Sheets and Noco selections stay unchanged', () => {
  const source = stripTypeScriptTypes(readFileSync(new URL('../index.ts', import.meta.url), 'utf8'));
  for (const mode of [undefined, '', 'sheets', ' Sheets ', 'google-sheets', 'unknown', 'noco', ' NOCO ', 'postgres', ' PostgreS ']) {
    const sheets = { source: 'sheets' }, noco = { source: 'noco' }, postgres = { source: 'postgres' };
    const calls: string[] = [], module = { exports: {} as { createAppDb(): unknown } };
    runInNewContext(source, { module, process: { env: { APP_DB: mode } }, require(id: string) {
      if (id === './google-sheets-db.ts') return { createGoogleSheetsDb: () => { calls.push('sheets'); return sheets; } };
      if (id === './noco/noco-db.ts') return { createNocoDb: () => { calls.push('noco'); return noco; } };
      if (id === './postgres/runtime.mts') return { createRuntimePostgresDb(s: unknown) {
        assert.equal(s, sheets); calls.push('postgres'); return postgres;
      } };
      throw new Error('unexpected_dependency');
    } });
    const expected = mode?.trim().toLowerCase();
    assert.equal(module.exports.createAppDb(), expected === 'noco' ? noco : expected === 'postgres' ? postgres : sheets);
    assert.deepEqual(calls, expected === 'noco' ? ['noco'] : expected === 'postgres' ? ['sheets', 'postgres'] : ['sheets']);
  }
});
test('SQL AppDb delegates both legacy selections to the unchanged real Sheets mapper', async () => {
  const { createGoogleSheetsDbFromValues } = createRequire(import.meta.url)('../google-sheets-db.ts') as {
    createGoogleSheetsDbFromValues(values: { personalDataValues: string[][] }): AppDb;
  };
  const sheets = createGoogleSheetsDbFromValues({ personalDataValues: [
    ['имя', 'Fake'], ['Реальные данные', ''], ['ФИО', 'Fake Author'], ['ТГ', '@Fake_Author'], ['рынок', 'Ru/En'],
    ['стек', 'Go'], ['Id общего чата', '-1'], ['Dolphin Profile Ru Id', '101'], ['Dolphin Profile En Id', '201'],
    ['Прокси Ru', 'ru-proxy'], ['Прокси En', 'en-proxy']
  ] });
  const sql = createPostgresAppDb(async () => { throw new Error('sql_not_allowed'); }, sheets);
  assert.deepEqual(await sql.getStudentTelegramRecords(), await sheets.getStudentTelegramRecords());
  assert.equal((await sql.getStudentTelegramRecords())[0].normalizedTelegram, 'fake_author');
  for (const market of ['Ru', 'En'] as const) {
    const actual = await sql.getProxyRequiredClients(market);
    assert.deepEqual(actual, await sheets.getProxyRequiredClients(market));
    assert.equal(actual[0].profileId, market === 'Ru' ? '101' : '201');
  }
});
