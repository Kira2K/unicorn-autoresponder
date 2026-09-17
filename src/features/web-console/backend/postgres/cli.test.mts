import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { combinedFixture } from './combined-fixture.mts';
import { createSqlLinkedInStorage } from './linkedin-repository.mts';
import type { LinkedInAuthDependencies } from '../../../linkedin-automation/account-connection/types.ts';
const require = createRequire(import.meta.url);
const { main } = require('../../../linkedin-automation/account-connection/cli.ts') as {
  main(args: string[], deps: LinkedInAuthDependencies, output: (text: string) => void): Promise<void> };
test('existing auth CLI resolves SQL target through supplied dependencies, with no live defaults', async () => {
  const f = combinedFixture(), repository = createSqlLinkedInStorage(f.db, f.grant).repository;
  const output: string[] = [], deps: LinkedInAuthDependencies = { repository, adapter: undefined,
    collectSession: async () => { throw Error('unexpected collection'); },
    inspectProfile: async id => { assert.equal(id, 7001);return { summary: { protocol: 'http', authenticated: false } }; } };
  await main(['--client', 'SQL fixture', '--platform-account-id', '21'], deps, text => output.push(text));
  assert.equal(JSON.parse(output[0]).mode, 'dry-run');
  assert.equal(JSON.parse(output[0]).target.platformAccountId, 21); assert.equal(f.count(), 0);
  await assert.rejects(main(['--client', 'SQL fixture', '--platform-account-id', '999'], deps, () => {}));
});
