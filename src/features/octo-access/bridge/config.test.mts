import test from 'node:test';
import assert from 'node:assert/strict';
import { readBridgeConfig } from './config.mts';
test('bridge is opt-in and cannot fall back from invalid configuration or a Guest session', () => {
  assert.equal(readBridgeConfig({}),undefined);
  const env={OCTO_PASSWORD_CLEANUP:'bridge',OCTO_BRIDGE_ID:'owner-pc',OCTO_BRIDGE_SECRET:'a'.repeat(48),OCTO_BRIDGE_OWNER_EMAIL:'Owner@example.com'};
  assert.equal(readBridgeConfig(env)!.ownerEmail,'owner@example.com');
  for (const patch of [{OCTO_PASSWORD_CLEANUP:'typo'},{OCTO_BRIDGE_ID:''},{OCTO_BRIDGE_SECRET:'short'},
    {OCTO_BRIDGE_OWNER_EMAIL:'kind.cute.unicorn@gmail.com'}])
    assert.throws(()=>readBridgeConfig({...env,...patch}),{code:'octo_bridge_configuration_required'});
});
