import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings } from './settings.mjs';
const config = { backendUrl: 'https://backend.example.com', bridgeId: 'owner', secret: 's'.repeat(43),
  ownerEmail: 'owner@example.com', allowedProfileUuids: ['a'.repeat(32)], allowAllManagedProfiles: true };
const read = async path => path.endsWith('octo-api-token') ? 'fake-owner-token' : JSON.stringify(config);
test('check is the default; logical service identity survives an instance/hostname change', async () => {
  const a = await loadSettings({ RENDER_SERVICE_ID: 'srv-one', RENDER_INSTANCE_ID: 'instance-a', HOSTNAME: 'old' }, read);
  const b = await loadSettings({ RENDER_SERVICE_ID: 'srv-one', RENDER_INSTANCE_ID: 'instance-b', HOSTNAME: 'new' }, read);
  const c = await loadSettings({ RENDER_SERVICE_ID: 'srv-two' }, read);
  assert.equal(a.mode, 'check'); assert.equal(a.machine, b.machine); assert.notEqual(a.machine, c.machine);
});
test('pilot UUID override disables the all-managed scope without changing the supplied config', async () => {
  const value = await loadSettings({ RENDER_SERVICE_ID: 'srv-one', OCTO_BRIDGE_MODE: 'worker',
    OCTO_BRIDGE_PROFILE_UUIDS: 'b'.repeat(32) }, read);
  assert.equal(value.config.allowAllManagedProfiles, false);
  assert.deepEqual(value.config.allowedProfileUuids, ['b'.repeat(32)]);
  assert.equal(config.allowAllManagedProfiles, true);
});
test('invalid mode, service, scope and secret content fail before any external access', async () => {
  for (const env of [{}, { RENDER_SERVICE_ID: 'srv-one', OCTO_BRIDGE_MODE: 'anything' },
    { RENDER_SERVICE_ID: 'srv-one', OCTO_BRIDGE_PROFILE_UUIDS: 'not-a-uuid' }])
    await assert.rejects(loadSettings(env, read));
  await assert.rejects(loadSettings({ RENDER_SERVICE_ID: 'srv-one' }, async () => { throw Error('PRIVATE CONTENT'); }),
    e => e.code === 'bridge_render_invalid_secrets' && !e.message.includes('PRIVATE'));
});
