// One desktop session at a time. Dependencies keep credentials out of errors/reports.
export function createCreatorDesktopSession({ local, guest, owner }: {
  local(path: string, body?: unknown): Promise<any>;
  guest: { email: string; password: string };
  owner: { email: string; token?: string; password?: string };
}) {
  const fail = (code: string) => { throw Object.assign(Error(code), { code }); };
  async function username() {
    return String((await local('/api/username')).username || '').trim().toLowerCase();
  }
  async function login(role: 'guest' | 'owner') {
    const active = await local('/api/profiles/active');
    if (!Array.isArray(active) || active.length) fail('denis_e2e_switch_has_active_profiles');
    const email = (role === 'guest' ? guest.email : owner.email).toLowerCase();
    if (await username().catch(() => '') === email) return role;
    if (role === 'owner' && !owner.password) fail('denis_e2e_owner_password_required');
    const body = role === 'guest' ? { email, password: guest.password }
      : { email, password: owner.password };
    await local('/api/auth/logout', {});
    try { await local('/api/auth/login', body); } catch { /* reconcile, never retry login blindly */ }
    const actual = await username().catch(() => '');
    if (actual !== email) fail('denis_e2e_desktop_login_unverified');
    return role;
  }
  return { username, guest: () => login('guest'), owner: () => login('owner') };
}

export function assertCreatorGuestProof(results: Array<{ taskId: number; guestVerified?: boolean }>) {
  if (![1, 9].every(id => results.some(r => r.taskId === id && r.guestVerified === true)))
    throw Object.assign(Error('denis_e2e_guest_proof_missing'), { code: 'denis_e2e_guest_proof_missing' });
}
