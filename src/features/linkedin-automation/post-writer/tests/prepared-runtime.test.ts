import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLivePostWriter } from '../runtime.ts'
import { createMemoryPostStore } from '../memory-store.ts'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

test('live runtime forwards the complete managed preparation policy and continuation', () => {
  const moduleUrl = (name: string) => JSON.stringify(pathToFileURL(resolve('src/features/linkedin-automation/post-writer', name)).href)
  // Isolated module mock exercises the real lazy runtime without acquiring its
  // production lease or constructing an external operation.
  const source = `
    import { mock } from 'node:test';
    import assert from 'node:assert/strict';
    const calls = [];
    mock.module(${moduleUrl('service.ts')}, {
      namedExports: { createPostWriterService: () => ({
        prepareManaged: async (...args) => { calls.push(args); return { id: 'daily' }; },
        stepManaged: async (...args) => { calls.push(args); return { status: 'ready' }; },
        close: async () => {}
      }) }
    });
    const { createLivePostWriter } = await import(${moduleUrl('runtime.ts')});
    const service = createLivePostWriter({ listAccounts: async () => { throw Error('unexpected accounts'); } },
      { acquire() { throw Error('unexpected write'); } }, { env: { LINKEDIN_POST_WRITER_ENABLED: 'false' },
        storage: { store: {}, cvRows: async () => { throw Error('unexpected CV'); } } });
    const policy = { contentMode: 'prepared', generateIfMissing: true }, cooperate = async action => action();
    try {
      await service.prepareManaged(105, '2026-09-29', 'scheduled-task', policy);
      assert.deepEqual(calls[0], [105, '2026-09-29', 'scheduled-task', policy]);
      await service.stepManaged('daily', false, cooperate);
      assert.deepEqual(calls[1], ['daily', false, cooperate]);
    } finally { await service.close(); }
  `
  execFileSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', source],
    { encoding: 'utf8', timeout: 20_000, stdio: 'pipe' })
})

test('normal runtime exposes prepared start and enforces read-only without external calls', async () => {
  const service = createLivePostWriter({ async listAccounts() { throw Error('no account lookup expected') } },
    { acquire() { throw Error('no external operation expected') } },
    { env: { LINKEDIN_POST_WRITER_ENABLED: 'false' }, storage: {
      store: createMemoryPostStore(), async cvRows() { throw Error('no CV lookup expected') }
    } })
  try {
    await assert.rejects(service.startPrepared(203, { date: '2026-09-23', text: 'Prepared text' }),
      /post_writer_read_only/)
  } finally { await service.close() }
})
