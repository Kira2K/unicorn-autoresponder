const {
  LINKEDIN_PLATFORM_ID,
  accountLinkedInUrl,
  linkedId,
  relatedClientId
} = require('./noco-target.ts') as Record<string, (...args: any[]) => any>
const { linkedInPublicIdentifier } = require('./profile-url.ts') as {
  linkedInPublicIdentifier(value: unknown): string
}
const { linkedinAuthErrorDisplay } = require('./error-display.ts') as {
  linkedinAuthErrorDisplay(value: unknown): { code: string } | undefined
}

type Row = Record<string, any> & { Id: number }
type AccountRow = import('./types.ts').LinkedInAuthAccountRow

function primaryStack(client: Row): { id?: number; name?: string } {
  const value = Array.isArray(client.rel_clients_primary_stack)
    ? client.rel_clients_primary_stack[0] : client.rel_clients_primary_stack
  const id = Number(value?.Id ?? value?.id)
  const name = String(value?.name ?? value?.stack ?? value?.stack_name ?? '').trim()
  return { ...(Number.isFinite(id) && id > 0 ? { id } : {}), ...(name ? { name } : {}) }
}

function optionalText(value: unknown): string | undefined {
  return String(value ?? '').trim() || undefined
}

function readinessError(account: Row, profiles: Row[], ownerId: number): string | undefined {
  try {
    linkedInPublicIdentifier(accountLinkedInUrl(account))
  } catch (error: any) {
    return String(error?.code || 'linkedin_url_invalid')
  }
  const enProfiles = profiles.filter(profile =>
    relatedClientId(profile, 'rel_dolphinProfiles_client') === ownerId &&
    String(profile.locale ?? '').trim().toLowerCase() === 'en'
  )
  if (!enProfiles.length) return 'dolphin_en_profile_not_found'
  if (enProfiles.length !== 1) return 'dolphin_en_profile_ambiguous'
  const profileId = Number(enProfiles[0].dolphin_profile_id)
  return Number.isFinite(profileId) && profileId > 0 ? undefined : 'dolphin_en_profile_not_found'
}

function listLinkedInAuthAccounts(input: { clients: Row[]; accounts: Row[]; profiles: Row[] }) {
  const clients = new Map(input.clients.map(client => [Number(client.Id), client]))
  return input.accounts
    .filter(account =>
      (linkedId(account.rel_platformAccounts_platform) ?? Number(account.platforms_id)) ===
      LINKEDIN_PLATFORM_ID
    )
    .map((account): AccountRow | null => {
      const clientId = relatedClientId(account, 'rel_platformAccounts_client')
      const client = clients.get(clientId)
      if (!clientId || !client) return null
      const enProfiles = input.profiles.filter(profile =>
        relatedClientId(profile, 'rel_dolphinProfiles_client') === clientId &&
        String(profile.locale ?? '').trim().toLowerCase() === 'en'
      )
      const profileId = enProfiles.length === 1 ? Number(enProfiles[0].dolphin_profile_id) : undefined
      const stack = primaryStack(client)
      return {
        platformAccountId: Number(account.Id),
        clientId,
        clientName: String(client.client_name ?? '').trim(),
        ...(stack.id ? { primaryStackId: stack.id } : {}),
        ...(stack.name ? { primaryStack: stack.name } : {}),
        linkedinUrl: accountLinkedInUrl(account),
        ...(Number.isFinite(profileId) && Number(profileId) > 0 ? { dolphinProfileId: profileId } : {}),
        readinessErrorCode: readinessError(account, input.profiles, clientId),
        unipileAccountId: optionalText(account.unipile_account_id),
        unipileAccountStatus: optionalText(account.unipile_account_status),
        verifiedProfileUrl: optionalText(account.linkedin_verified_profile_url),
        verifiedProviderId: optionalText(account.linkedin_verified_provider_id),
        verifiedProfileName: optionalText(account.linkedin_verified_profile_name),
        lastVerifiedAt: optionalText(account.linkedin_last_verified_at),
        authErrorCode: account.linkedin_auth_error_code
          ? linkedinAuthErrorDisplay(account.linkedin_auth_error_code)?.code
          : undefined,
        authUpdatedAt: optionalText(account.linkedin_auth_updated_at)
      }
    })
    .filter((row): row is AccountRow => Boolean(row))
    .sort((left, right) => left.clientName.localeCompare(right.clientName))
}

module.exports = { listLinkedInAuthAccounts }
