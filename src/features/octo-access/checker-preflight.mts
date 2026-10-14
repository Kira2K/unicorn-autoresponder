import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OctoError } from './contracts.mts';
import type { OwnProxyInput } from './checker-contract/api-types.ts';

/** Operator-only connection check: no proxy jobs, provider traffic, DB or Octo writes. */
export async function checkProxyCheckerConnection(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch) {
  let baseUrl: string;
  const secret = env.UNICORN_PROXY_CHECKER_SECRET_KEY;
  try {
    const url = new URL(env.PROXY_CHECKER_BASE_URL ?? '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !secret)
      throw Error();
    baseUrl = url.href.replace(/\/$/, '');
  } catch { throw new OctoError('octo_checker_configuration_required', 503); }
  try {
    const health = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!health.ok || (await health.json()).status !== 'ok') throw Error();
  } catch { throw new OctoError('octo_checker_unavailable', 503); }
  // The supplied API authenticates before parsing this deliberately incomplete URL.
  // It returns invalid_proxy without DNS lookup, a job, or provider requests.
  const body: OwnProxyInput = { unicorn_proxy_checker_secret_key: secret!, proxy: 'socks5://' };
  try {
    const response = await fetchImpl(`${baseUrl}/v1/proxies/check`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (response.status === 401) throw new OctoError('octo_checker_unauthorized', 503);
    if (response.status === 503) throw new OctoError('octo_checker_not_configured', 503);
    if (response.status !== 422 || (await response.json()).detail?.code !== 'invalid_proxy')
      throw new OctoError('octo_checker_preflight_unexpected_response', 502);
    return { reachable: true, secretAccepted: true, proxyChecksStarted: 0 };
  } catch (error) {
    if (error instanceof OctoError) throw error;
    throw new OctoError('octo_checker_unavailable', 503);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await checkProxyCheckerConnection(process.env))); }
  catch (error) {
    console.error(JSON.stringify({ error: error instanceof OctoError ? error.code : 'octo_checker_preflight_failed' }));
    process.exitCode = 1;
  }
}
