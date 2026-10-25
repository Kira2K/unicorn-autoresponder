import { createHash } from 'node:crypto';
import type { ManagedProfile, OctoConfig } from './contracts.mts';

// Compare the actual shared binding and folder scope, without exposing private state.
export function controlIdentity(p: ManagedProfile, config: OctoConfig) {
  return createHash('sha256').update(JSON.stringify([
    p.clientId, p.id, p.uuid, p.operationId, p.locale, config.homeFolder, config.guestFolder
  ])).digest('hex');
}
