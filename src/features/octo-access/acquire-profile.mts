import { OctoError } from './contracts.mts';
import type { OctoStore } from './contracts.mts';
import { proxyBusy } from './proxy-workflow.mts';

// Shared read-only acquisition checks for direct and delegated services.
export async function readGrantCandidate(store: Pick<OctoStore, 'get' | 'clientState'>,
  clientId: number, profileId: number, now = Date.now) {
  if (!Number.isSafeInteger(profileId) || profileId < 1) throw new OctoError('invalid_profile_id', 400);
  const profile = await store.get(profileId);
  if (!profile || profile.clientId !== clientId) throw new OctoError('not_found', 404);
  if (profile.deletion) throw new OctoError('octo_profile_deleting', 409);
  const operation = (await store.clientState(clientId))?.setup;
  if (operation && operation.phase !== 'complete' && profile.createdAt >= operation.createdAt)
    throw new OctoError('octo_profile_not_ready', 409);
  if (proxyBusy(profile)) throw new OctoError('octo_proxy_pending', 409);
  if (profile.grant && ['preparing', 'granted'].includes(profile.grant.phase)) {
    if (profile.grant.expiresAt && profile.grant.expiresAt <= now()) throw new OctoError('octo_cleanup_pending', 409);
    return { profile, existing: { id: profile.grant.id, phase: profile.grant.phase } };
  }
  if (profile.grant && profile.grant.phase !== 'complete') throw new OctoError('octo_cleanup_pending', 409);
  if (profile.phase !== 'ready' || !profile.uuid) throw new OctoError('octo_profile_not_ready', 409);
  return { profile, existing: undefined };
}
