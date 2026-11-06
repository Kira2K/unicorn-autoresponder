export function hasProxyMoveProfile(status) {
  return (status?.profiles || []).some(profile => profile.locale === 'en' &&
    Number.isSafeInteger(Number(profile.id)) && Number(profile.id) > 0 &&
    ['ready', 'preparing', 'granted', 'awaiting_close', 'complete'].includes(profile.phase) &&
    profile.proxy?.configured === true)
}
