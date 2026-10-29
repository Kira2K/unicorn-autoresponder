export function intakeScenario(data) { return data?.hasLinkedIn === true || String(data?.url || '').trim() ? 'existing' : '' }
export function registrationTimeInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
export function registrationTimeUtc(value) {
  if (!value) return undefined
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || registrationTimeInput(date) !== value) throw new Error('linkedin_intake_outlook_registration_invalid')
  return date.toISOString()
}
export function infrastructureSignature(status) {
  return JSON.stringify((status?.profiles || []).map(p => [p.id, p.locale, p.proxy?.type, p.proxy?.host, p.proxy?.port, p.proxy?.phase, p.proxy?.configured]))
}
export function infrastructureReady(status) {
  const available = p => ['ready', 'preparing', 'granted', 'awaiting_close', 'complete'].includes(p.phase)
  return !!status?.requiredLocales?.length && status.requiredLocales.every(locale => status.profiles?.some(p => p.locale === locale && available(p))) &&
    status.profiles.some(p => p.locale === 'en' && p.proxy?.configured && (!p.proxy.phase || p.proxy.phase === 'complete')) &&
    !['queued','checking','provisioning','unknown','awaiting_confirmation'].includes(status.onboarding?.phase)
}
export async function intakeRequest(method = 'GET', data, signal) {
  const response = await fetch('/api/client/linkedin-intake', { method, signal, credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(body.error || 'linkedin_intake_unavailable'), { status: response.status,fields:body.fields })
  return body
}
