import { isIP } from 'node:net'
import { codedError } from '../errors.ts'

const countryCache = new Map<string, string>()

async function requestCountry(ip: string, baseUrl: string, timeoutMs: number,
  fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(ip)}`, {
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) throw new Error('geo unavailable')
  const body = await response.json() as any
  if (body?.success === false) throw new Error('geo unavailable')
  return { name: String(body?.country ?? '').trim(), code: String(body?.country_code ?? '').trim() }
}

export async function resolveProxyCountry(proxy: any, options: {
  baseUrl: string; timeoutMs: number; fetchImpl?: typeof fetch
}) {
  const ip = String(proxy?.ip ?? '').trim()
  if (!isIP(ip)) throw codedError('profile_proxy_ip_missing',
    'The Dolphin proxy does not expose a valid IP address.')
  const cached = countryCache.get(ip)
  if (cached) return cached
  let country: { name: string; code: string } | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      country = await requestCountry(ip, options.baseUrl, options.timeoutMs,
        options.fetchImpl ?? fetch)
      break
    } catch { /* one bounded retry */ }
  }
  if (!country?.name) throw codedError('profile_proxy_country_unavailable',
    'The Dolphin proxy country could not be determined.')
  if (country.code.toUpperCase() === 'RU' || country.name.toLowerCase() === 'russia') {
    throw codedError('profile_proxy_country_disallowed',
      'LinkedIn profile generation is blocked for a Russian proxy country.')
  }
  countryCache.set(ip, country.name)
  return country.name
}

export function clearProxyCountryCache() {
  countryCache.clear()
}
