import { callProxyApi } from './checker-contract/api-client.ts';
import type { EndpointContracts, ProxyResult } from './checker-contract/api-types.ts';
import { OctoError } from './contracts.mts';

export type { ProxyResult } from './checker-contract/api-types.ts';
// Matches the supplied BestProxyInput default; the contract test detects drift.
export const OCTO_PROXY_CANDIDATE_COUNT = 20;
export type ProxyLocation = { country: string; region?: string; city?: string };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const invalid = (): never => { throw new OctoError('octo_proxy_check_invalid_response', 502); };

function result(value: unknown): ProxyResult {
  if (!record(value) || !Number.isInteger(value.index) || !text(value.proxy) || typeof value.ok !== 'boolean') return invalid();
  if (!value.ok || value.error != null) throw new OctoError('octo_proxy_check_failed', 422);
  if (typeof value.final_score !== 'number' || !Number.isFinite(value.final_score) || value.final_score < 0 || value.final_score > 100
    || !text(value.proxy_url)) return invalid();
  for (const field of ['exit_ip', 'ip_type', 'country', 'city'])
    if (value[field] != null && typeof value[field] !== 'string') return invalid();
  for (const field of ['median_ms', 'trust_score', 'latency_score'])
    if (value[field] != null && (typeof value[field] !== 'number' || !Number.isFinite(value[field]))) return invalid();
  if (value.location_matches != null && typeof value.location_matches !== 'boolean') return invalid();
  if (value.captcha != null && !['detected', 'not_detected', 'unknown'].includes(String(value.captcha))) return invalid();
  return value as ProxyResult;
}

/** Synchronous private API calls. Never retry an ambiguous network outcome. */
export function createProxyChecker(options: { baseUrl: string; secret: string; fetch?: typeof fetch }) {
  const fetchImpl = options.fetch ?? fetch;
  let cancellation = new AbortController();
  const request = async <P extends keyof EndpointContracts>(path: P, body: EndpointContracts[P]['request']) => {
    // Distinguish transport outcomes from response validation before invoking the supplied typed client.
    const safeFetch: typeof fetch = async (url, init) => {
      let response: Response;
      try { response = await fetchImpl(url, init); }
      catch { throw new OctoError('octo_proxy_check_unknown', 502); }
      if (!response.ok) throw new OctoError('octo_proxy_check_rejected', response.status === 429 ? 429 : 502);
      return response;
    };
    let data: unknown;
    try { data = await callProxyApi(options.baseUrl, path, body, AbortSignal.any([AbortSignal.timeout(900_000), cancellation.signal]), safeFetch); }
    catch (error) {
      if (error instanceof OctoError) throw error;
      if (error instanceof SyntaxError) return invalid();
      throw new OctoError('octo_proxy_check_unknown', 502);
    }
    if (!record(data) || !text(data.check_id) || !text(data.created_at) || typeof data.status !== 'string') return invalid();
    if (!['queued', 'running', 'completed', 'failed'].includes(data.status)) return invalid();
    if (data.status !== 'completed' || data.error != null) throw new OctoError('octo_proxy_check_failed', 422);
    return data;
  };
  return {
    cancel() { cancellation.abort(); cancellation = new AbortController(); },
    async check(proxy: string): Promise<ProxyResult> {
      const data = await request('/v1/proxies/check', { unicorn_proxy_checker_secret_key: options.secret, proxy });
      if (!Array.isArray(data.results) || data.results.length !== 1) return invalid();
      return result(data.results[0]);
    },
    async best(key: string, location: ProxyLocation): Promise<ProxyResult> {
      const data = await request('/v1/proxies/best', { unicorn_proxy_checker_secret_key: options.secret, api_key: key, count: OCTO_PROXY_CANDIDATE_COUNT,
        location: { country: location.country, ...(location.region ? { region: location.region } : {}), ...(location.city ? { city: location.city } : {}),
          protocol: 'socks5', connection_type: 'residential', session_mode: 'sticky', filter_mode: 'quality', ipv4_only: true } });
      if ('results' in data || !data.best_proxy) return invalid();
      const winner = result(data.best_proxy);
      // The service verifies actual country codes and requested city; its country output is a display name.
      if (winner.location_matches !== true || !text(winner.country) || (location.city && !text(winner.city)))
        throw new OctoError('octo_proxy_location_unverified', 422);
      return winner;
    }
  };
}
