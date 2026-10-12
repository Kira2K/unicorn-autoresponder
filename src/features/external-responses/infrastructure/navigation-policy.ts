export function isLinkedInUrl(value: string): boolean {
  try { const host = new URL(value).hostname.toLowerCase().replace(/\.$/, ''); return ['linkedin.com', 'lnkd.in'].some(domain => host === domain || host.endsWith('.' + domain)) } catch { return false }
}
export function assertAllowedUrl(value: string) { if (isLinkedInUrl(value)) throw Error('linkedin_navigation_forbidden') }
