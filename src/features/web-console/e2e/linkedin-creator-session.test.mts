import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorDesktopSession, createManualCreatorSession, createIsolatedCreatorSession, creatorOwnerFetch, assertCreatorGuestProof } from './linkedin-creator-session.mts';
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
test('manual mode observes account switching without reading passwords or sending auth mutations', async () => {
  let name = owner.email, clock = 0;
  const paths: string[] = [], notices: string[] = [];
  const session = createManualCreatorSession({ guestEmail: guest.email, ownerEmail: owner.email,
    now: () => clock, wait: async () => { clock += 1000; name = guest.email; },
    notify: async role => { notices.push(role); }, local: async path => {
      paths.push(path); return path.endsWith('/active') ? [] : { username: name };
    } });
  await session.verifyOwner(); await session.guest();
  assert.deepEqual(notices, ['owner','guest']); assert.ok(paths.every(p => !p.includes('/auth/')));
});
test('isolated owner rewrites only bridge localhost endpoints; guest stays on its own Desktop', async () => {
  const paths: string[] = [];
  const fetchOwner = creatorOwnerFetch(58889, (async (input: any) => {
    paths.push(String(input)); return Response.json({ username: owner.email });
  }) as typeof fetch);
  const session = createIsolatedCreatorSession({ ownerFetch: fetchOwner, ownerEmail: owner.email, guestEmail: guest.email,
    local: async () => ({ username: guest.email }) });
  await session.verifyOwner(); await session.guest();
  await fetchOwner('https://stand.example.test/internal/octo-bridge/v1/health');
  assert.deepEqual(paths, ['http://127.0.0.1:58889/api/username','https://stand.example.test/internal/octo-bridge/v1/health']);
  await assert.rejects(fetchOwner('http://127.0.0.1:58888/api/auth/logout'), { code: 'bridge_invalid_local_endpoint' });
  assert.throws(() => creatorOwnerFetch(58888), { code: 'denis_e2e_owner_port_invalid' });
});
