import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

export function runRepositoryRoutingTests() {
  const url = new URL('../repository.ts', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import Module from 'node:module';
    import fs from 'node:fs';
    import os from 'node:os';
    import path from 'node:path';
    const original = Module._load;
    let created = 0, reads = 0;
    Module._load = function(id, ...args) {
      if (id === '../../integrations/noco/core/client.ts') return { createNocoClient(options) {
        assert.deepEqual(options, { pageDelayMs: 750, retryDelaysMs: [0,5000,15000,45000] });
        created++; return { async fetchRecords() { reads++; return []; } };
      } };
      return original.call(this, id, ...args);
    };
    const { createProfileFillerRepository } = await import(${JSON.stringify(url)});
    delete process.env.APP_DB;
    for (const mode of [undefined, '', 'sheets', 'noco', ' NOCO ', 'unknown']) {
      const repo = createProfileFillerRepository(mode, async () => { throw new Error('unexpected_sql'); });
      assert.deepEqual(await repo.listClients(), []);
    }
    assert.equal(created, 6); assert.equal(reads, 6);
    process.env.APP_DB = ' PostgreS ';
    // Exercise the default service factory, including new recovery/smoke paths.
    // Invalid SQL configuration must stop before Drive/Dolphin or any Noco fallback.
    process.env.APP_DB_POSTGRES_DATABASE = 'invalid-test-database';
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-sql-routing-'));
    process.env.PROFILE_FILLER_ARTIFACT_ROOT = directory;
    try {
      const { createProfileFillerService } = await import(new URL('./service.ts', ${JSON.stringify(url)}).href);
      const service = createProfileFillerService({
        drive: { loadCv() { throw new Error('unexpected_drive'); } },
        extractor: { extract() { throw new Error('unexpected_extractor'); } },
        withPage() { throw new Error('unexpected_browser'); }
      });
      for (const mode of [undefined, 'work-permits', 'privacy', 'delete-old', 'verify-final']) {
        const result = await service.run(1, 'En', false, undefined, false,
          mode === 'work-permits' ? 'draft-0' : undefined, mode, mode === 'verify-final' ? ['draft-0'] : []);
        assert.equal(result.ok, false); assert.match(result.message, /invalid_appdb_postgres_config/);
      }
      const dryRun = await service.run(1, 'En', true);
      assert.equal(dryRun.ok, false); assert.match(dryRun.message, /invalid_appdb_postgres_config/);
      const smoke = await service.runLiveSmoke(1, 'En');
      assert.equal(smoke.ok, false); assert.match(smoke.message, /invalid_appdb_postgres_config/);
      assert.equal(created, 6); assert.equal(reads, 6);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    const failure = new Error('sql_failed');
    await assert.rejects(createProfileFillerRepository(undefined, async () => { throw failure; }).listClients(), e => e === failure);
    assert.equal(created, 6); assert.equal(reads, 6);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
}
