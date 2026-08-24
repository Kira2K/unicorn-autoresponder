const { assertAccountOperational, verifiedIdentity } = require('../account-connection/account-validation.ts') as {
  assertAccountOperational(account: any): void
  verifiedIdentity(account: any, profile: any, target: any): any
}

type JsonObject = import('./input-types.ts').JsonObject
type ProfileAccount = import('./plan-types.ts').ProfileAccount
type ProfileClient = import('./plan-types.ts').ProfileClient

function codedError(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}

async function resolveProfileAccount(
  repository: any, client: ProfileClient, platformAccountId: number, sections: string[]
): Promise<{ account: ProfileAccount; profile: JsonObject }> {
  const row = (await repository.listAccounts()).find((item: any) =>
    Number(item.platformAccountId) === platformAccountId)
  if (!row) throw codedError('linkedin_account_not_found', 'LinkedIn account was not found.')
  if (!row.unipileAccountId || row.unipileAccountStatus !== 'running' || !row.lastVerifiedAt) {
    throw codedError('profile_filler_auth_required', 'Verify or reconnect LinkedIn first.')
  }
  const remoteAccount = await client.getAccount(row.unipileAccountId)
  assertAccountOperational(remoteAccount)
  const profile = await client.getOwnProfile(row.unipileAccountId, sections)
  const identity = verifiedIdentity(remoteAccount, profile, {
    expectedLinkedInUrl: row.linkedinUrl,
    verifiedProviderId: row.verifiedProviderId
  })
  return {
    account: {
      platformAccountId, clientName: row.clientName, accountId: row.unipileAccountId,
      providerId: identity.providerId, profileUrl: identity.profileUrl
    },
    profile
  }
}

function requestedSections(profile: import('./input-types.ts').ProfileInput) {
  const result: string[] = []
  if (profile.experience.length) result.push('linkedin_experience')
  if (profile.education.length) result.push('linkedin_education')
  if (profile.skills.add.length) result.push('linkedin_skills')
  return result
}

module.exports = { requestedSections, resolveProfileAccount }
