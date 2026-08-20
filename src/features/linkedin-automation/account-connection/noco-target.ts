const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}
const { linkedInPublicIdentifier } = require('./profile-url.ts') as {
  linkedInPublicIdentifier(value: unknown): string
}

const LINKEDIN_PLATFORM_ID = 16
type Row = Record<string, any> & { Id: number }

function linkedId(value: any): number | undefined {
  const item = Array.isArray(value) ? value[0] : value
  const id = Number(item?.Id ?? item?.id)
  return Number.isFinite(id) && id > 0 ? id : undefined
}

function clientId(row: Row, relation: string): number | undefined {
  const id = linkedId(row[relation]) ?? Number(row.clients_id)
  return Number.isFinite(id) && id > 0 ? id : undefined
}

function accountLinkedInUrl(row: Row): string {
  return String(row.linkedin_url ?? '').trim() || String(row.url ?? '').trim()
}

function resolveClient(clients: Row[], name: string): Row {
  const key = name.trim().toLowerCase()
  const matches = clients.filter(row => String(row.client_name ?? '').trim().toLowerCase() === key)
  if (matches.length !== 1) {
    throw new LinkedInAuthError(
      matches.length ? 'noco_client_ambiguous' : 'noco_client_not_found',
      `Expected one Noco client named "${name}", found ${matches.length}.`
    )
  }
  return matches[0]
}

function resolveLinkedInAccount(accounts: Row[], ownerId: number, selectedId?: number): Row {
  const matches = accounts.filter(row =>
    clientId(row, 'rel_platformAccounts_client') === ownerId &&
    (linkedId(row.rel_platformAccounts_platform) ?? Number(row.platforms_id)) === LINKEDIN_PLATFORM_ID
  )
  const selected = selectedId ? matches.filter(row => Number(row.Id) === selectedId) : matches
  if (selected.length !== 1) {
    throw new LinkedInAuthError(
      selected.length ? 'linkedin_account_ambiguous' : 'linkedin_account_not_found',
      `Expected one LinkedIn platform account, found ${selected.length}.`
    )
  }
  linkedInPublicIdentifier(accountLinkedInUrl(selected[0]))
  return selected[0]
}

function resolveEnProfile(profiles: Row[], ownerId: number): Row {
  const matches = profiles.filter(row =>
    clientId(row, 'rel_dolphinProfiles_client') === ownerId &&
    String(row.locale ?? '').trim().toLowerCase() === 'en'
  )
  const ids = matches.map(row => Number(row.dolphin_profile_id)).filter(id => Number.isFinite(id) && id > 0)
  if (matches.length !== 1 || ids.length !== 1) {
    throw new LinkedInAuthError(
      matches.length ? 'dolphin_en_profile_ambiguous' : 'dolphin_en_profile_not_found',
      `Expected one valid En Dolphin profile, found ${matches.length}.`
    )
  }
  return { ...matches[0], dolphin_profile_id: ids[0] }
}

function resolveLinkedInAuthTarget(input: {
  clients: Row[]
  accounts: Row[]
  profiles: Row[]
  clientName: string
  platformAccountId?: number
}) {
  const client = resolveClient(input.clients, input.clientName)
  const account = resolveLinkedInAccount(input.accounts, Number(client.Id), input.platformAccountId)
  const profile = resolveEnProfile(input.profiles, Number(client.Id))
  return {
    clientId: Number(client.Id), clientName: String(client.client_name),
    dolphinProfileId: Number(profile.dolphin_profile_id), platformAccountId: Number(account.Id),
    expectedLinkedInUrl: accountLinkedInUrl(account),
    unipileAccountId: String(account.unipile_account_id ?? '').trim() || undefined,
    unipileAccountStatus: String(account.unipile_account_status ?? '').trim() || undefined,
    verifiedProviderId: String(account.linkedin_verified_provider_id ?? '').trim() || undefined
  }
}

module.exports = { LINKEDIN_PLATFORM_ID, accountLinkedInUrl, resolveLinkedInAuthTarget }
