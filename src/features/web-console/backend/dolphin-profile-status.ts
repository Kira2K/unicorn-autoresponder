const {
  buildProfileName,
  buildProxyNameExample,
  getRequiredClientDataIssues,
  requiredLocalesForMarket
} = require('./dolphin-profile-provisioning.ts') as {
  buildProfileName(client: any, locale: 'ru' | 'en'): string
  buildProxyNameExample(client: any): string
  getRequiredClientDataIssues(client: any, options?: { requireCalendarEmail?: boolean }): Array<{
    field: string
    fieldLabel: string
    message: string
  }>
  requiredLocalesForMarket(market: unknown): Array<'ru' | 'en'>
}

type DolphinProfileStatus = import('./types.ts').DolphinProfileStatus

function requiredLocales(client: any): Array<'ru' | 'en'> {
  try {
    return requiredLocalesForMarket(client.market)
  } catch {
    return []
  }
}

function localeSortValue(locale: string): number {
  return locale === 'ru' ? 0 : locale === 'en' ? 1 : 2
}

function buildDolphinProfileStatus(options: {
  client: any
  existingProfiles: Array<{ id: number; locale: string }>
  actorRole: 'client' | 'admin' | 'provider'
}): DolphinProfileStatus {
  const requiredFields = getRequiredClientDataIssues(options.client, {
    requireCalendarEmail: options.actorRole === 'client'
  })
  const existingProfiles = [...options.existingProfiles]
    .sort((a, b) => localeSortValue(a.locale) - localeSortValue(b.locale) || a.id - b.id)
  const locales = requiredFields.length ? [] : requiredLocales(options.client)
  const existingLocales = new Set(existingProfiles.map(profile => String(profile.locale || '').toLowerCase()))
  const missingLocales = locales.filter(locale => !existingLocales.has(locale))

  return {
    targetClientId: options.client.id,
    targetClientName: options.client.clientName,
    actorRole: options.actorRole,
    action: requiredFields.length ? 'blocked' : missingLocales.length ? 'create_new' : 'open_existing',
    existingProfiles,
    requiredLocales: locales,
    missingLocales,
    expectedProfileNames: requiredFields.length
      ? []
      : locales.map(locale => ({ locale, name: buildProfileName(options.client, locale) })),
    expectedProxyName: !requiredFields.length && locales.includes('en')
      ? buildProxyNameExample(options.client)
      : '',
    requiredFields
  }
}

module.exports = { buildDolphinProfileStatus }
