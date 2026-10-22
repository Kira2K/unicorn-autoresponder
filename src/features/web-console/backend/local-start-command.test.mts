import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const scripts = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')).scripts;
const configUrl = new URL('../../octo-access/config.mts', import.meta.url).href;
const probe = `import { readOctoConfig } from ${JSON.stringify(configUrl)};
  const c = readOctoConfig(process.env);
  console.log(JSON.stringify({ enabled: c?.enabled ?? false,
    allowed: !!c && c.enabled && (c.allowAll || c.allowedClientIds.has(261)) }));`;

function environment(): NodeJS.ProcessEnv {
  return Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
}

for (const command of ['web:backend', 'web:backend:dev']) {
  test(`${command}: local configuration restores OctoGuide, honors explicit disablement, and needs no optional files`, () => {
    const parts: string[] = scripts[command].split(' ');
    assert.equal(parts.shift(), 'node');
    assert.equal(parts.pop(), 'src/features/web-console/backend/index.ts');
    assert.equal(parts.includes('--watch'), command === 'web:backend:dev');
    const flags = parts.filter(flag => flag !== '--watch');
    const cwd = mkdtempSync(join(tmpdir(), 'unicorn-console-config-'));
    const run = (extra: NodeJS.ProcessEnv = {}) => {
      const result = spawnSync(process.execPath, [...flags, '--input-type=module', '-e', probe],
        { cwd, env: { ...environment(), ...extra }, encoding: 'utf8', timeout: 10_000, windowsHide: true });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout.trim());
    };
    try {
      assert.deepEqual(run(), { enabled: false, allowed: false });
      writeFileSync(join(cwd, '.env'), 'OCTO_API_TOKEN=fixture-only\nOCTO_GUEST_PASSWORD=12345\n');
      writeFileSync(join(cwd, '.env.octo-pilot'), ['OCTO_ENABLED=1', 'OCTO_ALLOWED_CLIENT_IDS=248,249',
        `OCTO_HOME_FOLDER_UUID=${'a'.repeat(32)}`, `OCTO_GUEST_FOLDER_UUID=${'b'.repeat(32)}`].join('\n'));
      assert.deepEqual(run(), { enabled: true, allowed: false });
      writeFileSync(join(cwd, '.env.octo-onboarding'), 'OCTO_ACCESS_SCOPE=all\n');
      assert.deepEqual(run(), { enabled: true, allowed: true });
      assert.deepEqual(run({ OCTO_ENABLED: '0' }), { enabled: false, allowed: false });
    } finally {
      assert.equal(dirname(cwd), tmpdir());
      assert.ok(basename(cwd).startsWith('unicorn-console-config-'));
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}

test('web:dev uses the configured watched backend; production does not load local Octo overlays', () => {
  assert.equal(scripts['web:dev'], 'node src/features/web-console/dev-launcher.ts');
  assert.match(readFileSync(new URL('../dev-launcher.ts', import.meta.url), 'utf8'), /\['run', 'web:backend:dev'\]/);
  assert.equal(scripts['web:start'], 'node src/features/web-console/backend/index.ts');
});
