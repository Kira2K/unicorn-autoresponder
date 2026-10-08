import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const { resolveStorage } = require('./hh-autoresponses-storage.cjs');
const script = fileURLToPath(new URL('./run-hh-autoresponses-daily.ps1', import.meta.url));
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
function fixture(envFile: string, run: (cwd: string) => void) {
  const cwd = mkdtempSync(join(tmpdir(), 'hh-storage-test-'));
  try { writeFileSync(join(cwd, '.env'), envFile); run(cwd); }
  finally { rmSync(cwd, { recursive: true, force: true }); }
}
test('storage uses process value, then .env, then SQL; rejects unknown storage', () => {
  fixture('APP_DB=postgres\n', cwd => {
    assert.equal(resolveStorage({}, cwd), 'postgres');
    assert.equal(resolveStorage({ APP_DB: '  ' }, cwd), 'postgres');
    assert.equal(resolveStorage({ APP_DB: ' NOCO ' }, cwd), 'noco');
    for (const APP_DB of ['postgre', 'sheets']) assert.throws(() => resolveStorage({ APP_DB }, cwd), /APP_DB/);
  });
  fixture('', cwd => assert.equal(resolveStorage({}, cwd), 'postgres'));
  fixture('APP_DB=noco\n', cwd => {
    assert.equal(resolveStorage({}, cwd), 'noco');
    assert.equal(resolveStorage({ APP_DB: 'postgres' }, cwd), 'postgres');
  });
  fixture('APP_DB=invalid\n', cwd => assert.throws(() => resolveStorage({}, cwd), /APP_DB/));
});
function wrapper(cwd: string, selected: string, failRu = false) {
  const npm = `function npm { Write-Output ('TEST_STORAGE:'+$env:APP_DB+':'+$env:ORCHESTRATOR_WORK_WITH_MARKET); $global:LASTEXITCODE=${failRu ? "if($env:ORCHESTRATOR_WORK_WITH_MARKET -eq 'Ru'){7}else{0}" : '0'} }`;
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${npm}; & ${quote(script)} -AutoresponsesRepo ${quote(cwd)}; exit $LASTEXITCODE`], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { SystemRoot: process.env.SystemRoot, PATH: dirname(process.execPath) + ';' + process.env.PATH, PATHEXT: '.COM;.EXE;.BAT;.CMD', APP_DB: selected }
  });
}
for (const selected of ['', 'noco', 'postgres']) test(`daily wrapper uses configured storage: ${selected || '.env postgres'}`, { skip: process.platform !== 'win32' }, () => {
  fixture('APP_DB=postgres\n', cwd => {
    const result = wrapper(cwd, selected);
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    assert.deepEqual(result.stdout.trim().split(/\r?\n/), [`TEST_STORAGE:${selected || 'postgres'}:Ru`, `TEST_STORAGE:${selected || 'postgres'}:En`]);
  });
});
test('daily wrapper rejects unknown storage before either market is started', { skip: process.platform !== 'win32' }, () => {
  fixture('APP_DB=typo\n', cwd => {
    const result = wrapper(cwd, '');
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout.includes('TEST_STORAGE:'), false);
    assert.match(result.stderr, /Cannot resolve HH autoresponses storage/);
  });
});
test('daily wrapper continues En after Ru failure and preserves failure code', { skip: process.platform !== 'win32' }, () => {
  fixture('APP_DB=postgres\n', cwd => {
    const result = wrapper(cwd, '', true);
    assert.equal(result.status, 7, result.error?.message || result.stderr);
    assert.deepEqual(result.stdout.split(/\r?\n/).filter(line => line.startsWith('TEST_STORAGE:')),
      ['TEST_STORAGE:postgres:Ru', 'TEST_STORAGE:postgres:En']);
  });
});
test('direct HH entry point uses the same storage and logs no credentials', () => {
  const source = stripTypeScriptTypes(readFileSync(new URL('../src/features/hh-responses/cli/orchestrator.ts', import.meta.url), 'utf8'));
  fixture('', cwd => {
    for (const selected of [undefined, 'postgres', 'noco', 'typo']) {
      const logs: unknown[] = [], dbCalls: string[] = [];
      const env: Record<string, string | undefined> = { APP_DB: selected, APP_DB_POSTGRES_DATABASE: 'working', APP_DB_POSTGRES_PASSWORD: 'do-not-log' };
      const db = {};
      const module = { exports: {} as any };
      runInNewContext(source, { module, process: { env }, console, require(id: string) {
        if (id === 'dotenv') return { config() {} };
        if (id.endsWith('/hh-autoresponses-storage.cjs')) return { resolveStorage: () => resolveStorage(env, cwd) };
        if (id.endsWith('/platform/db/index.ts')) return { createAppDb() { dbCalls.push(env.APP_DB!); return db; } };
        if (id.endsWith('/reporting.ts')) return { writeLocalRunLog(record: unknown) { logs.push(record); } };
        return {};
      } });
      if (selected === 'typo') {
        assert.throws(() => module.exports.createHHAppDb(), /APP_DB/);
        assert.equal(dbCalls.length, 0);
      } else {
        assert.equal(module.exports.createHHAppDb(), db);
        assert.deepEqual(dbCalls, [selected || 'postgres']);
        assert.equal(JSON.stringify(logs).includes('do-not-log'), false);
        assert.equal((logs[0] as any).storage, selected || 'postgres');
      }
    }
  });
});

test('readiness CLI selects SQL before reads and closes it even when the read fails', async () => {
  const source = stripTypeScriptTypes(readFileSync(new URL('../src/integrations/noco/hh-response-readiness/index.ts', import.meta.url), 'utf8'));
  await new Promise<void>((resolve, reject) => fixture('', cwd => {
    (async () => {
      for (const failure of [false, true]) {
        const env: Record<string, string | undefined> = {};
        const calls: string[] = [];
        const module = { exports: {} as any };
        const sql = { async fetchRecords() { calls.push('sql-read'); if (failure) throw new Error('sql-unavailable'); return []; } };
        runInNewContext(source, { module, process: { env, argv: ['node', 'readiness', '--market=ru', '--json'] }, console: { log() {} }, require(id: string) {
          if (id === 'dotenv') return { config() {} };
          if (id.endsWith('/hh-autoresponses-storage.cjs')) return { resolveStorage: () => resolveStorage(env, cwd) };
          if (id.endsWith('/platform/db/index.ts')) return { createAppDb() { calls.push(`db:${env.APP_DB}`); return {}; } };
          if (id.endsWith('/hh-readiness.mts')) return { hhReadinessOptions(mode: string, db: unknown) { assert.equal(mode, 'postgres'); return { db, nocoClient: sql }; } };
          if (id.endsWith('/runtime.mts')) return { async closeRuntimePostgresDb() { calls.push('closed'); } };
          if (id.endsWith('/noco-db.ts')) return { createNocoDb() { throw new Error('unexpected-noco-db'); } };
          if (id === '../core/client.ts') return { createNocoClient() { throw new Error('unexpected-noco-http'); } };
          if (id === '../core/schema.ts') return { TABLES: Object.fromEntries(['clients', 'dolphinProfiles', 'hhAutoresponses', 'platformAccounts', 'stacks'].map(id => [id, { id }])) };
          throw new Error(`unexpected import: ${id}`);
        } });
        if (failure) await assert.rejects(module.exports.main(), /sql-unavailable/);
        else await module.exports.main();
        assert.equal(calls[0], 'db:postgres');
        assert.equal(calls.at(-1), 'closed');
        assert.ok(calls.includes('sql-read'));
      }
    })().then(resolve, reject);
  }));
});
