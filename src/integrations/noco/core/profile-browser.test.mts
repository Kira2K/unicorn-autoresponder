import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { isDolphinProfile } = createRequire(import.meta.url)('./profile-browser.ts') as {
  isDolphinProfile(row: Record<string, unknown>): boolean;
};

test('Dolphin readers preserve legacy snapshots and exclude Octo and unknown providers', () => {
  const rows = [{ Id: 1 }, { Id: 2, browser: 'dolphin' }, { Id: 3, browser: 'octo' },
    { Id: 4, browser: 'unknown' }, { Id: 5, browser: null }, { Id: 6, browser: '' }];
  assert.deepEqual(rows.filter(isDolphinProfile).map(row => row.Id), [1, 2]);
});
