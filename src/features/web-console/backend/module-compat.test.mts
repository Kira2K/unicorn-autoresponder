import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const guard = fileURLToPath(new URL('./tests/no-outbound.cjs', import.meta.url));
const tsx = require.resolve('tsx/cli');
const tsxLoader = pathToFileURL(require.resolve('tsx')).href;
const backend = fileURLToPath(new URL('./index.ts', import.meta.url));
const source = (path: string) => join(root, path);
// Do not inherit provider tokens, NODE_OPTIONS, writer flags or a developer's .env.
function environment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP', 'HOME'])
    if (process.env[key]) env[key] = process.env[key];
  return { ...env, NODE_ENV: 'test', UNIPILE_API_KEY: 'module-test-only',
    UNIPILE_API_BASE_URL: 'https://example.invalid', DOTENV_CONFIG_QUIET: 'true', TSX_DISABLE_CACHE: '1',
    APP_DB: 'postgres', WEB_CONSOLE_USE_MOCK_DATA: 'true',
    LINKEDIN_CONNECTION_WRITER_ENABLED: 'false', LINKEDIN_POST_WRITER_ENABLED: 'false' };
}

for (const loader of ['node', 'tsx'] as const) {
  for (const mode of ['require-first', 'import-first'] as const) {
    for (const [feature, factory] of [
      ['comment-monitor', 'createCommentUnipileAdapter'],
      ['connection-inviter', 'createConnectionUnipileAdapter'],
    ]) {
      test(`${loader} ${mode}: constructs real ${feature} HTTP adapter`, () => {
        const cwd = mkdtempSync(join(tmpdir(), 'unicorn-import-'));
        const path = source(`src/features/linkedin-automation/${feature}/unipile-adapter.ts`);
        const load = mode === 'require-first' ? `require(${JSON.stringify(path)})`
          : `await import(${JSON.stringify(pathToFileURL(path).href)})`;
        const code = `(async () => {
          const assert = require('node:assert/strict');
          const loaded = ${load};
          const adapter = (loaded.default ?? loaded)[${JSON.stringify(factory)}]();
          assert.equal(typeof adapter.getAccount, 'function');
          assert.equal(typeof adapter.getOwnProfile, 'function');
          console.log('adapter-created');
        })().catch(error => { console.error(error); process.exitCode = 1; });`;
        try {
          const child = spawnSync(process.execPath, ['--require', guard,
            ...(loader === 'tsx' ? ['--import', tsxLoader] : []), '-e', code],
          { cwd, env: environment(), encoding: 'utf8', timeout: 20_000, windowsHide: true });
          assert.ifError(child.error);
          assert.equal(child.status, 0, child.stdout + child.stderr);
          assert.doesNotMatch(child.stderr, /startup_test_outbound_blocked/);
          assert.match(child.stdout, /adapter-created/);
        } finally { rmSync(cwd, { recursive: true, force: true }); }
      });
    }
  }
}

for (const loader of ['node', 'tsx'] as const) {
  test(`${loader}: imports and constructs SQL stores without opening a database`, () => {
    const cwd = mkdtempSync(join(tmpdir(), 'unicorn-sql-import-'));
    const path = source('src/features/web-console/backend/postgres/app-options.mts');
    const code = `(async () => {
      const assert = require('node:assert/strict');
      const { sqlAppOptions } = await import(${JSON.stringify(pathToFileURL(path).href)});
      const { combinedFixture } = require(${JSON.stringify(source('src/features/web-console/backend/postgres/combined-fixture.mts'))});
      const f = combinedFixture();
      const options = sqlAppOptions(f.db, f.grant, { accountIds: new Set([21]), create: f.grant.create });
      assert.equal(typeof options.linkedinStorage.inviter.listRuns, 'function');
      assert.equal(typeof options.linkedinStorage.comments.list, 'function');
      assert.equal(typeof options.linkedinStorage.posts.store.list, 'function');
      console.log('sql-stores-created');
    })().catch(error => { console.error(error); process.exitCode = 1; });`;
    try {
      const child = spawnSync(process.execPath, ['--require', guard,
        ...(loader === 'tsx' ? ['--import', tsxLoader] : []), '-e', code],
      { cwd, env: environment(), encoding: 'utf8', timeout: 20_000, windowsHide: true });
      assert.ifError(child.error);
      assert.equal(child.status, 0, child.stdout + child.stderr);
      assert.doesNotMatch(child.stderr, /startup_test_outbound_blocked/);
      assert.match(child.stdout, /sql-stores-created/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
}

for (const mode of ['node', 'tsx-watch'] as const) {
  test(`${mode}: normal backend entrypoint serves HTTP with isolated mock data`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'unicorn-startup-'));
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => {
      reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve);
    });
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    const child = spawn(process.execPath, ['--require', guard,
      ...(mode === 'tsx-watch' ? [tsx, 'watch', '--clear-screen=false'] : []), backend], {
      cwd, env: { ...environment(), WEB_CONSOLE_HOST: '127.0.0.1', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let output = '';
    let spawnError: Error | undefined;
    child.stdout.on('data', value => { output += value; });
    child.stderr.on('data', value => { output += value; });
    child.on('error', error => { spawnError = error; });
    const closed = once(child, 'close');
    try {
      const deadline = Date.now() + 25_000;
      while (!output.includes('Web console backend listening at') && Date.now() < deadline) {
        assert.ifError(spawnError);
        assert.equal(child.exitCode, null, output);
        if (output.includes('Web console startup blocked')) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.match(output, /Web console backend listening at/, output);
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { signal: AbortSignal.timeout(3000) });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, 'unauthorized');
      assert.doesNotMatch(output, /startup_test_outbound_blocked/);
    } finally {
      if (child.pid && child.exitCode === null) {
        if (process.platform === 'win32') {
          const stopped = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'],
            { encoding: 'utf8', windowsHide: true });
          assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
        } else child.kill('SIGTERM');
      }
      await closed;
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
