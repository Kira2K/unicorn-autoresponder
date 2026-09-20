import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { checkSqlStorage } from './check.mts';
import { runtimeFixture } from './runtime-fixture.mts';
import { cvLocalColumns } from './workflow-fields.mts';
import { tableIds } from './tables.mts';
function fixture() {
  const f = runtimeFixture();
  const connect = f.pool.connect;
  f.pool.connect = async () => {
    const session = await connect(); const query = session.query;
    session.query = async (text, values) => {
      const result = await query(text, values);
      if (text.includes('copy_meta.inventory')) for (const row of result.rows) {
        const d = row.definition as any;
        if (d.id === tableIds.cv) for (const name of cvLocalColumns) {
          d.columns.push({ id: name, title: name, uidt: 'LongText' });
          d.mapping.push({ id: name, title: name, sqlName: name, sqlType: 'text' });
        }
      }
      return result;
    };
    return session;
  };
  return f;
}
test('SQL check reads tables and IDs without writes, migrations or services', async () => {
  const f = fixture();
  const result = await checkSqlStorage(f.env, () => f.pool);
  assert.equal(result.writes, false); assert.equal(result.backgroundJobs, false);
  assert.equal(result.idTables, 11); assert.equal(f.state.ends, 1);
  assert.ok(f.calls.some(c => c.includes('LIMIT')));
  assert.ok(!f.calls.some(c => /nextval|\b(ALTER|INSERT|UPDATE|DELETE)\b/.test(c)));
});
test('invalid mode, missing columns, IDs and read errors fail closed', async () => {
  let opens = 0;
  await assert.rejects(checkSqlStorage({}, () => { opens++; throw Error('must_not_open'); }), /sql_check_requires_postgres/);
  assert.equal(opens, 0);
  const missing = runtimeFixture();
  await assert.rejects(checkSqlStorage(missing.env, () => missing.pool), /sql_check_cv_columns_required/);
  assert.equal(missing.state.ends, 1);
  const ids = fixture(); ids.state.ready = false;
  await assert.rejects(checkSqlStorage(ids.env, () => ids.pool), /postgres_id_allocator_required/);
  assert.equal(ids.state.ends, 1);
  const failed = fixture(), connect = failed.pool.connect;
  failed.pool.connect = async () => { const s = await connect(), query = s.query; s.query = async (text, values) => {
    if (text.includes('LIMIT')) throw Error('offline'); return query(text, values);
  }; return s; };
  await assert.rejects(checkSqlStorage(failed.env, () => failed.pool)); assert.equal(failed.state.ends, 1);
});

function runCli(version: string, args: string[] = [], envFailure = false) {
  const script = new URL('../../../../../scripts/check-sql.mts', import.meta.url).href;
  const code = `
    Object.defineProperty(process, 'version', { value: ${JSON.stringify('v' + version)} });
    Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} });
    process.argv = ['node', 'check-sql.mts', ...${JSON.stringify(args)}];
    process.loadEnvFile = file => {
      console.log('ENV_PATH:' + file);
      if (${envFailure}) throw new Error('SECRET_ENV_VALUE');
      process.env.APP_DB = 'noco';
    };
    await import(${JSON.stringify(script)});
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    cwd: tmpdir(), windowsHide: true, timeout: 20000, encoding: 'utf8',
    env: { SystemRoot: process.env.SystemRoot, NODE_NO_WARNINGS: '1' }
  });
  assert.ifError(result.error);
  return result;
}
for (const version of ['24.12.0', '24.19.0', '24.20.0', '24.20.1', '24.21.0', '25.0.0', '26.0.0']) {
  test(`CLI version gate accepts Node ${version} and still rejects non-SQL mode before connecting`, () => {
    const result = runCli(version);
    assert.equal(result.status, 1);
    assert.equal(result.stdout.trim(), 'ENV_PATH:.env');
    assert.match(result.stderr, /sql_check_requires_postgres/);
    assert.doesNotMatch(result.stderr, /node_version/);
  });
}
for (const version of ['20.20.0', '22.16.0', '24.11.9']) {
  test(`CLI version gate rejects Node ${version} before reading ENV`, () => {
    const result = runCli(version);
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.match(result.stderr, /node_version/);
    assert.match(result.stderr, /Node 24\.12\.0 или новее/);
  });
}
test('CLI keeps argument handling and does not expose ENV failures', () => {
  const invalid = runCli('24.20.0', ['first.env', 'second.env']);
  assert.equal(invalid.status, 1); assert.equal(invalid.stdout, ''); assert.match(invalid.stderr, /arguments/);
  const custom = runCli('24.20.0', ['private-test.env']);
  assert.equal(custom.stdout.trim(), 'ENV_PATH:private-test.env');
  const failure = runCli('24.20.0', [], true);
  assert.equal(failure.status, 1); assert.match(failure.stderr, /sql_check_failed/);
  assert.doesNotMatch(failure.stderr, /SECRET_ENV_VALUE/);
});
