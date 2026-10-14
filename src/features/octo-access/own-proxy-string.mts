import { createRequire } from 'node:module';
import { OctoError } from './contracts.mts';
import type { ProxyInput } from './contracts.mts';
import { parseProxyInput } from './proxy-input.mts';

const { parseProxyUrl } = createRequire(import.meta.url)('../linkedin-automation/account-connection/proxy-input.ts') as {
  parseProxyUrl(value: string): { type: string; host: string; port: number; login?: string; password?: string };
};

/** Parse one SOCKS proxy; returned credentials are for server-side use only. */
export function parseOwnSocksProxy(raw: string): ProxyInput {
  const fail = (): never => { throw new OctoError('octo_proxy_input_invalid', 400); };
  if (typeof raw !== 'string' || /[\r\n]/.test(raw) || !raw.trim()) return fail();
  const value = raw.trim();
  try {
    if (value.includes('://')) {
      const url = new URL(value);
      if (!['socks5:', 'socks5h:'].includes(url.protocol) || url.pathname || url.search || url.hash) return fail();
      return parseProxyInput({ ...parseProxyUrl(value.replace(/^socks5h:/i, 'socks5:')), type: 'socks5' });
    }
    const parts = value.split(':');
    if (parts.length !== 2 && parts.length < 4) return fail();
    const [host, port, login = '', ...password] = parts;
    if (!/^\d+$/.test(port)) return fail();
    return parseProxyInput({ type: 'socks5', host, port, login, password: password.join(':') });
  } catch { return fail(); }
}
