import { OctoError } from './contracts.mts';
import type { ProxyLocation } from './proxy-checker.mts';

export type LocationOption = { code: string; name: string; availability?: string };
type Level = 'countries' | 'regions' | 'cities';
const invalidSelection = (): never => { throw new OctoError('octo_proxy_location_invalid', 400); };
const invalidResponse = (): never => { throw new OctoError('octo_proxy_catalogue_invalid_response', 502); };
const validCode = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
  && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && value === value.trim();
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Authenticated server-side catalogue, fetched afresh without static fallbacks. */
export function createNodeMavenCatalogue(options: { fetch?: typeof fetch } = {}) {
  const fetchImpl = options.fetch ?? fetch;
  async function list(key: string, level: Level, country?: string, region?: string): Promise<LocationOption[]> {
    if (typeof key !== 'string' || !key.trim() || key.length > 512 || /[\r\n]/.test(key)
      || !['countries', 'regions', 'cities'].includes(level)
      || (country !== undefined && !validCode(country)) || (region !== undefined && !validCode(region))
      || (level !== 'countries' && !country) || (level === 'countries' && (country !== undefined || region !== undefined))
      || (level === 'regions' && region !== undefined)) return invalidSelection();
    const all: LocationOption[] = [], seen = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const url = new URL(`https://api.nodemaven.com/api/v2/base/locations/${level}/`);
      url.search = new URLSearchParams({ limit: '1000', offset: String(offset), connection_type: 'residential', ipv4_only: 'true',
        ...(country ? { country__code: country } : {}), ...(region ? { region__code: region } : {}) }).toString();
      let response: Response;
      try { response = await fetchImpl(url, { headers: { Authorization: 'x-api-key ' + key }, signal: AbortSignal.timeout(15_000) }); }
      catch { throw new OctoError('octo_proxy_catalogue_unavailable', 502); }
      if (!response.ok) throw new OctoError('octo_proxy_catalogue_rejected', response.status === 429 ? 429 : 502);
      let data: unknown;
      try { data = await response.json(); }
      catch { return invalidResponse(); }
      if (!record(data) || !Array.isArray(data.results) || data.results.length > 1000) return invalidResponse();
      for (const item of data.results) {
        if (!record(item) || !validCode(item.code) || typeof item.name !== 'string' || !item.name.trim() || seen.has(item.code)) return invalidResponse();
        const availability = item.availability ?? item.effective_availability;
        if (availability !== undefined && availability !== null && typeof availability !== 'string') return invalidResponse();
        seen.add(item.code);
        all.push({ code: item.code, name: item.name, ...(typeof availability === 'string' ? { availability } : {}) });
      }
      if (data.results.length < 1000) return all;
    }
  }
  async function validate(key: string, location: ProxyLocation): Promise<ProxyLocation> {
    if (!record(location) || !validCode(location.country) || (location.region !== undefined && !validCode(location.region))
      || (location.city !== undefined && !validCode(location.city))) return invalidSelection();
    const { country, region, city } = location;
    if (!(await list(key, 'countries')).some(item => item.code === country)) return invalidSelection();
    const regions = await list(key, 'regions', country);
    if (region && !regions.some(item => item.code === region)) return invalidSelection();
    if (regions.length && !region) throw new OctoError('octo_proxy_region_required', 400);
    const cities = await list(key, 'cities', country, region);
    if (city && !cities.some(item => item.code === city)) return invalidSelection();
    if (cities.length && !city) throw new OctoError('octo_proxy_city_required', 400);
    return { country, ...(region ? { region } : {}), ...(city ? { city } : {}) };
  }
  return { list, validate };
}
