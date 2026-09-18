import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

export function runRepositoryRoutingTests() {
  const url = new URL('../repository.ts', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import Module from 'node:module';
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
    const failure = new Error('sql_failed');
    await assert.rejects(createProfileFillerRepository(undefined, async () => { throw failure; }).listClients(), e => e === failure);
    assert.equal(created, 6); assert.equal(reads, 6);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}
