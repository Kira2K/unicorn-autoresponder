import { codedError } from '../errors.ts'

const countryNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })

export async function resolveProxyCountry(proxy: any) {
  // Another program maintains lastCheck. Its age and IP are not revalidated here.
  const code = String(proxy?.lastCheck?.country ?? '').trim().toUpperCase()
  const country = /^[A-Z]{2}$/.test(code) && code !== 'ZZ' ? countryNames.of(code) : undefined
  if (!country) throw codedError('profile_proxy_country_unavailable',
    'The latest Dolphin proxy check does not provide a country.')
  if (code === 'RU') {
    throw codedError('profile_proxy_country_disallowed',
      'LinkedIn profile generation is blocked for a Russian proxy country.')
  }
  return country
}
