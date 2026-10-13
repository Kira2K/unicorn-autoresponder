import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWebConsoleRepository } = require('./repository.ts');
const { TABLES } = require('../../../integrations/noco/core/schema.ts');

test('Console Dolphin inventory excludes Octo and unknown rows even with a Dolphin id', async () => {
  const repository = createWebConsoleRepository({ nocoClient: {
    async fetchRecords(id: string) {
      assert.equal(id, TABLES.dolphinProfiles.id);
      return [
        { Id: 1, clients_id: 7, locale: 'Ru', dolphin_profile_id: '101' },
        { Id: 2, clients_id: 7, locale: 'En', browser: 'dolphin', dolphin_profile_id: '102' },
        { Id: 3, clients_id: 7, locale: 'Ru', browser: 'octo', octo_profile_id: 'octo-only' },
        { Id: 4, clients_id: 7, locale: 'En', browser: 'unknown', dolphin_profile_id: '103' }
      ];
    }
  } });
  assert.deepEqual(await repository.getAllDolphinProfileIds(), [101, 102]);
  assert.deepEqual(await repository.getDolphinProfileIdsForClient(7), [101, 102]);
  assert.deepEqual(await repository.getDolphinProfilesForClient(7), [{ id: 101, locale: 'ru' }, { id: 102, locale: 'en' }]);
});
