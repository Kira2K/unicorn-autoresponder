import { createRequire } from 'node:module';
const { createBridgeLocalFetch } = createRequire(import.meta.url)('../../../../octo-bridge/local-api.mjs') as {
  createBridgeLocalFetch(port: number, fetchImpl: typeof fetch): typeof fetch };
// One desktop session at a time. Dependencies keep credentials out of errors/reports.
export function createCreatorDesktopSession({ local, guest, owner }: {
  local(path: string, body?: unknown): Promise<any>;
  guest: { email: string; password: string };
  owner: { email: string; token?: string; password?: string };
}) {
  const fail = (code: string) => { throw Object.assign(Error(code), { code }); };
  const refused = new Set<string>();
  async function username() {
    return String((await local('/api/username')).username || '').trim().toLowerCase();
  }
  async function login(role: 'guest' | 'owner', reauthenticate = false) {
    const active = await local('/api/profiles/active');
    if (!Array.isArray(active) || active.length) fail('denis_e2e_switch_has_active_profiles');
    const email = (role === 'guest' ? guest.email : owner.email).toLowerCase();
    if (!reauthenticate && await username().catch(() => '') === email) return role;
    if (refused.has(role)) fail('denis_e2e_desktop_login_requires_review');
    if (role === 'owner' && !owner.password) fail('denis_e2e_owner_password_required');
    const body = role === 'guest' ? { email, password: guest.password }
      : { email, password: owner.password };
    await local('/api/auth/logout', {});
    try { await local('/api/auth/login', body); } catch { /* reconcile, never retry login blindly */ }
    const actual = await username().catch(() => '');
    if (actual !== email) { refused.add(role); fail('denis_e2e_desktop_login_unverified'); }
    return role;
  }
  return { username, guest: () => login('guest'), owner: () => login('owner'), verifyOwner: () => login('owner', true) };
}

export function assertCreatorGuestProof(results: Array<{ taskId: number; guestVerified?: boolean }>) {
  if (![1, 9].every(id => results.some(r => r.taskId === id && r.guestVerified === true)))
    throw Object.assign(Error('denis_e2e_guest_proof_missing'), { code: 'denis_e2e_guest_proof_missing' });
}

// Operator switches using Octo's saved-account menu; the runner only observes identity.
export function createManualCreatorSession({ local, guestEmail, ownerEmail, notify,
  wait = () => new Promise<void>(r => setTimeout(r, 1000)), now = Date.now }: {
  local(path: string): Promise<any>; guestEmail: string; ownerEmail: string;
  notify(role: 'guest' | 'owner'): Promise<void>;
  wait?(): Promise<void>; now?(): number;
}) {
  async function switchTo(role: 'guest' | 'owner') {
    const email = (role === 'guest' ? guestEmail : ownerEmail).toLowerCase();
    const deadline = now() + (role === 'guest' ? 90_000 : 20 * 60_000);
    await notify(role);
    do {
      const username = String((await local('/api/username').catch(() => ({}))).username || '').toLowerCase();
      if (username === email) {
        const active = await local('/api/profiles/active');
        if (!Array.isArray(active) || active.length) throw Object.assign(Error(), { code: 'denis_e2e_switch_has_active_profiles' });
        return role;
      }
      await wait();
    } while (now() < deadline);
    throw Object.assign(Error(), { code: 'denis_e2e_manual_switch_timeout' });
  }
  return { guest: () => switchTo('guest'), owner: () => switchTo('owner'), verifyOwner: () => switchTo('owner') };
}

export function creatorOwnerFetch(port: number, fetchImpl: typeof fetch = fetch): typeof fetch {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 58888)
    throw Object.assign(Error(), { code: 'denis_e2e_owner_port_invalid' });
  return createBridgeLocalFetch(port, fetchImpl);
}

export function createIsolatedCreatorSession({ local, ownerFetch, ownerEmail, guestEmail }: {
  local(path: string): Promise<any>; ownerFetch: typeof fetch; ownerEmail: string; guestEmail: string;
}) {
  async function owner() {
    const r = await ownerFetch('http://127.0.0.1:58888/api/username', { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    if (!r.ok || String(j.username || '').toLowerCase() !== ownerEmail.toLowerCase())
      throw Object.assign(Error(), { code: 'denis_e2e_isolated_owner_unverified' });
    return 'owner' as const;
  }
  async function guest() {
    if (String((await local('/api/username')).username || '').toLowerCase() !== guestEmail.toLowerCase())
      throw Object.assign(Error(), { code: 'denis_e2e_guest_identity_required' });
    return 'guest' as const;
  }
  return { owner, verifyOwner: owner, guest };
}
