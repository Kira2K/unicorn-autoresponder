import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseConfig } from '../bridge/agent.mjs';

export const fail = code => Object.assign(new Error(code), { code });
export async function loadSettings(env = process.env, read = readFile) {
  const mode = env.OCTO_BRIDGE_MODE ?? 'check';
  if (!['check', 'worker'].includes(mode) || !/^[a-zA-Z0-9_-]{3,100}$/.test(env.RENDER_SERVICE_ID ?? ''))
    throw fail('bridge_render_invalid_settings');
  let token, config;
  try {
    token = (await read('/run/octo-secrets/octo-api-token', 'utf8')).trim();
    config = parseConfig(JSON.parse(await read('/run/octo-secrets/bridge.config.json', 'utf8')));
  } catch { throw fail('bridge_render_invalid_secrets'); }
  if (!token || /[\r\n\0]/.test(token)) throw fail('bridge_render_invalid_secrets');
  if (env.OCTO_BRIDGE_PROFILE_UUIDS) {
    config.allowedProfileUuids = env.OCTO_BRIDGE_PROFILE_UUIDS.split(',').map(s => s.trim());
    config.allowAllManagedProfiles = false;
    try { config = parseConfig(config); } catch { throw fail('bridge_render_invalid_profile_scope'); }
  }
  return {
    mode, token, config, dataDir: '/var/data',
    machine: createHash('sha256').update(`unicorn-octo-render:${env.RENDER_SERVICE_ID}`).digest('hex'),
  };
}
