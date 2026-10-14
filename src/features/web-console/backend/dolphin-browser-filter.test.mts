import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWebConsoleRepository } = require('./repository.ts');
const { TABLES } = require('../../../integrations/noco/core/schema.ts');
const { ensureProfileAccessInput } = require('./app.ts');

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

test('Client opens its existing Ru Dolphin profile despite En market and missing creation prerequisites', async () => {
  const client = { id: 7, market: 'En', clientName: '', calendarEmail: '', firstName: '', lastName: '' };
  let provisionCalls = 0, statusReads = 0;
  const repository = {
    async getDolphinProfilesForClient() { statusReads++; return [{ id: 101, locale: 'ru' }]; },
    async getDolphinProfileIdsForClient(clientId: number) { assert.equal(clientId, 7); return [101]; },
    async getAllDolphinProfileIds() { return [101, 202]; }
  };
  const provisioner = { async ensureClientProfiles() { provisionCalls++; throw new Error('must_not_create'); } };
  assert.deepEqual(await ensureProfileAccessInput({ repository, provisioner, client, actorRole: 'client', mode: 'open_existing' }),
    { profileIds: [101], knownProfileIds: [101, 202] });
  assert.equal(provisionCalls, 0);
  assert.equal(statusReads, 0, 'opening existing client profiles skips market and personal-data creation checks');
  await assert.rejects(ensureProfileAccessInput({ repository, provisioner, client, actorRole: 'admin', mode: 'open_existing' }),
    (error: { code?: string }) => error.code === 'missing_dolphin_profile_personal_data');
  assert.equal(provisionCalls, 0, 'admin prerequisites still apply before any creation');
});

test('Client open_existing still rejects absent Dolphin profiles', async () => {
  await assert.rejects(ensureProfileAccessInput({
    repository: { async getDolphinProfileIdsForClient() { return []; }, async getAllDolphinProfileIds() { return [202]; } },
    provisioner: { async ensureClientProfiles() { throw new Error('must_not_create'); } },
    client: { id: 7, market: 'En' }, actorRole: 'client', mode: 'open_existing'
  }), (error: { code?: string }) => error.code === 'missing_dolphin_profiles');
});
