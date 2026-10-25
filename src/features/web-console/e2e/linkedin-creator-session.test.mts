import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorDesktopSession, assertCreatorGuestProof } from './linkedin-creator-session.mts';
const guest = { email: 'guest@example.test', password: 'private-guest' };
const owner = { email: 'owner@example.test', password: 'private-owner-password' };
test('desktop switching checks closed profiles and reads back the actual identity', async () => {
  let name = owner.email, active: unknown[] = [], calls = 0;
  const session = createCreatorDesktopSession({ guest, owner, local: async (path, body: any) => {
    if (path.endsWith('/active')) return active;
    if (path.endsWith('/username')) return { username: name };
    if (path.endsWith('/logout')) { name = ''; return {}; }
    calls++; name = body.email;
    if (name === owner.email) assert.equal(body.password, owner.password);
    else assert.equal(body.password, guest.password);
    return { msg: 'Logged in successfully' };
  } });
  await session.verifyOwner(); await session.guest(); assert.equal(await session.username(), guest.email);
  active = [{}]; await assert.rejects(session.owner(), { code: 'denis_e2e_switch_has_active_profiles' });
  assert.equal(calls, 2); active = []; await session.owner(); assert.equal(calls, 3);
});
test('refused or lost login is not retried or mistaken for a verified switch', async () => {
  let calls = 0;
  const session = createCreatorDesktopSession({ guest, owner, local: async path => {
    if (path.endsWith('/active')) return [];
    if (path.endsWith('/username')) return { username: owner.email };
    if (path.endsWith('/logout')) return {};
    calls++; throw Error('upstream includes credentials');
  } });
  await assert.rejects(session.guest(), { code: 'denis_e2e_desktop_login_unverified' });
  await assert.rejects(session.guest(), { code: 'denis_e2e_desktop_login_requires_review' });
  assert.equal(calls, 1);
});
test('missing owner credentials cannot log out a guest', async () => {
  const paths: string[] = [];
  const session = createCreatorDesktopSession({ guest, owner: { email: owner.email }, local: async path => {
    paths.push(path); return path.endsWith('/active') ? [] : { username: guest.email };
  } });
  await assert.rejects(session.owner(), { code: 'denis_e2e_owner_password_required' });
  assert.ok(!paths.some(p => p.endsWith('/logout')));
});
test('both tasks require guest proof, owner launches cannot pass the full E2E', () => {
  for (const results of [[], [{ taskId: 1, guestVerified: true }], [{ taskId: 1 }, { taskId: 9 }]])
    assert.throws(() => assertCreatorGuestProof(results), { code: 'denis_e2e_guest_proof_missing' });
  assertCreatorGuestProof([{ taskId: 1, guestVerified: true }, { taskId: 9, guestVerified: true }]);
});
