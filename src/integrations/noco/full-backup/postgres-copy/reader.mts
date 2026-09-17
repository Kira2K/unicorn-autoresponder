import { createRequire } from 'node:module';
import { parse } from './json.mts';
import type { Reader } from './contracts.mts';
const require = createRequire(import.meta.url);
const { createNocoRequestLimiter } = require('../../core/request-limiter.ts') as {
  createNocoRequestLimiter(options: { log(event: Record<string, unknown>): void }): {
    schedule<T>(kind: 'read', action: () => Promise<T>): Promise<T>;
  };
};
export function createReader(baseUrl: string, token: string,
  log: (event: Record<string, unknown>) => void = () => {}): Reader {
  const limiter = createNocoRequestLimiter({ log });
  return { async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, baseUrl);
    if (url.origin !== new URL(baseUrl).origin || !path.startsWith('/api/')) throw new Error('invalid_noco_path');
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    for (let attempt = 1; ; attempt++) {
      try {
        return await limiter.schedule('read', async () => {
          let response: Response;
          try { response = await fetch(url, { headers: { 'xc-token': token, 'Cache-Control': 'no-cache' },
            redirect: 'error', signal: AbortSignal.timeout(120_000) }); }
          catch { throw new Error('noco_transport_failed'); }
          if (!response.ok) {
            await response.body?.cancel();
            throw Object.assign(new Error(`noco_http_${response.status}`), {
              response: { status: response.status, headers: { 'retry-after': response.headers.get('retry-after') ?? '' } }
            });
          }
          return parse(await response.text()) as T;
        });
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response?.status;
        if (attempt >= 4 || status !== 429) throw error;
        log({ event: 'retry', status, attempt });
      }
    }
  } };
}
