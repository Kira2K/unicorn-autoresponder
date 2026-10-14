import { createRequire } from 'node:module';
import { OctoError } from './contracts.mts';
import type { ProxyInput } from './contracts.mts';
const { normalizeProtocol } = createRequire(import.meta.url)('../linkedin-automation/account-connection/proxy.ts') as {
  normalizeProtocol(value: unknown): ProxyInput['type'];
};
export function parseProxyInput(value: unknown): ProxyInput {
  const fail = (): never => { throw new OctoError('octo_proxy_input_invalid', 400); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const data = value as Record<string, unknown>;
  let type: ProxyInput['type'];
  try { type = normalizeProtocol(data.type); } catch { return fail(); }
  const host = typeof data.host === 'string' ? data.host.trim() : '', port = Number(data.port);
  if (host.length < 4 || host.length > 253 || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return fail();
  const login = data.login ?? '', password = data.password ?? '';
  if (typeof login !== 'string' || typeof password !== 'string' || login.length > 255 || password.length > 255 || /[\r\n]/.test(login + password)) return fail();
  const changeIpUrl = typeof data.changeIpUrl === 'string' ? data.changeIpUrl.trim() : '';
  if (changeIpUrl) {
    try { if (!['http:', 'https:'].includes(new URL(changeIpUrl).protocol) || changeIpUrl.length > 4096) return fail(); }
    catch { return fail(); }
  }
  return { type, host, port, login, password, ...(changeIpUrl ? { changeIpUrl } : {}) };
}
