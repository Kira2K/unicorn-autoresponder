import type { OctoConfig } from './contracts.mts';

export function octoClientAllowed(config: OctoConfig, clientId: number): boolean {
  return config.enabled !== false && Number.isSafeInteger(clientId) && clientId > 0 &&
    (config.allowAll === true || config.allowedClientIds.has(clientId));
}
