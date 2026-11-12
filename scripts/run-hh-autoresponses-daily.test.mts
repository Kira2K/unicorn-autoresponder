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
function wrapper(extra: string[] = [], exitCode = 0, target = script) {
  const fake = "$ErrorActionPreference='Stop'; function Test-HhNode { ConvertTo-Json -InputObject @($args) -Compress; $global:LASTEXITCODE=" + exitCode + " }";
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    fake + '; & ' + quote(target) + ' -NodePath Test-HhNode ' + extra.map(x=>x.startsWith('-')?x:quote(x)).join(' ') + '; exit $LASTEXITCODE'], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, PATHEXT: '.COM;.EXE;.BAT;.CMD' }
  });
}
test('daily task delegates once to the supervisor, allowing ENV or its 100/4 defaults', { skip: process.platform !== 'win32' }, () => {
  const r = wrapper(); assert.equal(r.status, 0, r.stderr);
  const args = JSON.parse(r.stdout.trim()); assert.match(args[0], /supervised[\\/]cli\.cjs$/);
  assert.deepEqual(args.slice(1), []);
});
test('daily task preserves explicit parameters, ENV path with spaces and the failure exit code', { skip: process.platform !== 'win32' }, () => {
  const r = wrapper(['-ResponseLimit','80','-Concurrency','2','-EnvFile','C:\\private folder\\hh.env','-AllowWeekend'], 7);
  assert.equal(r.status, 7, r.stderr);
  const args = JSON.parse(r.stdout.trim());
  assert.deepEqual(args.slice(1), ['--limit=80','--concurrency=2','--env-file=C:\\private folder\\hh.env','--allow-weekend']);
});
test('skill first step invokes service inspection; full mode explicitly tests inference', { skip: process.platform !== 'win32' }, () => {
  const first = fileURLToPath(new URL('../.agents/skills/hh-autoresponses/scripts/first-check.ps1', import.meta.url));
  for (const mode of ['inspect','full']) {
    const r = wrapper(['-Mode',mode],0,first); assert.equal(r.status,0,r.stderr);
    const args = JSON.parse(r.stdout.trim()); assert.match(args[0],/services-cli\.cjs$/);
    assert.equal(args[1],'--mode='+mode);
  }
});

test('real powershell -File registration resolves its own checkout and remains a dry run', { skip: process.platform !== 'win32' }, () => {
 fixture('',cwd=>{
  const register=fileURLToPath(new URL('./register-hh-autoresponses-task.ps1',import.meta.url));
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',register,'-AtLocal','05:40','-EnvFile',join(cwd,'.env'),'-NodePath',process.execPath],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(r.status,0,r.stderr);const plan=JSON.parse(r.stdout);assert.equal(plan.apply,false);assert.equal(plan.atLocal,'05:40');assert.equal(plan.checkAtLocal,'04:40');assert.equal(plan.repo,dirname(dirname(register)));
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
          if (id.endsWith('/shared/telegram-group-chat.ts')) return require('../shared/telegram-group-chat.ts');
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
