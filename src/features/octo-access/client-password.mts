import { OctoError } from './contracts.mts';
import type { OctoStore } from './contracts.mts';
import { generateProfilePassword } from './password.mts';

export async function ensureClientPassword(store: OctoStore, clientId: number, draw = generateProfilePassword) {
  const existing = await store.clientState(clientId);
  if (existing) return existing;
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = draw();
    if (!/^\d{5}$/.test(candidate)) throw new OctoError('octo_password_unavailable', 503);
    try { return await store.claimClientPassword(clientId, candidate); }
    catch (error) { if ((error as { code?: string }).code !== 'octo_password_conflict') throw error; }
  }
  throw new OctoError('octo_password_unavailable', 503);
}
