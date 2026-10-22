import { OctoError } from '../contracts.mts';
import type { BridgeIdentity } from './broker.mts';
export interface BridgeConfig extends BridgeIdentity { secret: string }
export function readBridgeConfig(env: NodeJS.ProcessEnv): BridgeConfig | undefined {
  const mode = env.OCTO_PASSWORD_CLEANUP ?? 'cloud';
  if (mode === 'cloud') return;
  const id = env.OCTO_BRIDGE_ID ?? '', secret = env.OCTO_BRIDGE_SECRET ?? '', ownerEmail = (env.OCTO_BRIDGE_OWNER_EMAIL ?? '').trim().toLowerCase();
  if (mode !== 'bridge' || !/^[a-z0-9_-]{1,60}$/.test(id) || !/^[A-Za-z0-9_-]{43,128}$/.test(secret) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) || ownerEmail === (env.OCTO_GUEST_EMAIL ?? 'kind.cute.unicorn@gmail.com').toLowerCase())
    throw new OctoError('octo_bridge_configuration_required', 503);
  return { id, secret, ownerEmail };
}
