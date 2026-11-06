// Compare connection values, not access phases or a browser's temporary title.
export function proxyDraftSignature(value = {}) {
  return JSON.stringify([value.type || 'http', String(value.host || '').trim().toLowerCase(), Number(value.port) || 0,
    value.login || '', value.password || '', String(value.changeIpUrl || '').trim()])
}
export function proxyDraftChanged(draft, saved) {
  return !!saved && proxyDraftSignature(draft) !== proxyDraftSignature(saved)
}
