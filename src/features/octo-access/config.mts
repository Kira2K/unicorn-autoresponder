import { OctoError } from './contracts.mts';
import type { OctoConfig } from './contracts.mts';
export function readOctoConfig(env: NodeJS.ProcessEnv): OctoConfig | undefined {
  const enabled = env.OCTO_ENABLED === '1';
  // Keeping folder configuration when disabled lets old grants drain safely.
  if (!enabled && !env.OCTO_HOME_FOLDER_UUID) return;
  const ids = (env.OCTO_ALLOWED_CLIENT_IDS ?? '').split(',').map(s => Number(s.trim()));
  const homeFolder = env.OCTO_HOME_FOLDER_UUID ?? '', guestFolder = env.OCTO_GUEST_FOLDER_UUID ?? '';
  const email = env.OCTO_GUEST_EMAIL ?? 'kind.cute.unicorn@gmail.com', password = env.OCTO_GUEST_PASSWORD ?? '';
  if (!env.OCTO_API_TOKEN || ids.length !== 2 || new Set(ids).size !== 2 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)
    || !/^[a-f0-9]{32}$/i.test(homeFolder) || !/^[a-f0-9]{32}$/i.test(guestFolder) || homeFolder === guestFolder
    || (enabled && !password)) throw new OctoError('octo_configuration_required', 503);
  // Production duration is fixed. Shorter deadlines exist only in injected test configs.
  return { enabled, allowedClientIds: new Set(ids), homeFolder, guestFolder, guest: { email, password }, leaseMs: 120_000 };
}
