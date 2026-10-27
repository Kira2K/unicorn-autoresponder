import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectOwner } from './readiness.mjs';
const settings = { mode: 'check', config: { ownerEmail: 'owner@example.com' } };
const api = (current = '3.1.3', update_required = false, username = 'OWNER@example.com') => async url =>
  Response.json(String(url).endsWith('/username') ? { username } : { current, update_required });
test('owner readiness reports only safe version fields and permits inspection of an untested version', async () => {
  assert.deepEqual(await inspectOwner(58888, settings, api('3.1.4')), {
    ownerVerified: true, octoVersion: '3.1.4', updateRequired: false });
});
test('worker requires the tested owner/version; check mode never hides a wrong owner', async () => {
  const worker = { ...settings, mode: 'worker' };
  await inspectOwner(58888, worker, api());
  for (const mock of [api('3.1.4'), api('3.1.3', true)])
    await assert.rejects(inspectOwner(58888, worker, mock), { code: 'bridge_render_octo_version_requires_review' });
  await assert.rejects(inspectOwner(58888, settings, api('3.1.3', false, 'guest@example.com')), { code: 'bridge_wrong_owner' });
});
