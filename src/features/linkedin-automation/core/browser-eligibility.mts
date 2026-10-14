import { linkedinBrowserErrorText } from './browser-error-display.mts'

/** LinkedIn only: table readers already exclude non-Dolphin profile bindings.
 * Recheck their readiness before using a previously connected Unipile account.
 * No provider calls or writes; legacy injected snapshots remain supported.
 */
export function assertDolphinAccount(row: {
  readinessErrorCode?: string; dolphinProfileId?: number; browser?: unknown
}) {
  const profileId = Number(row.dolphinProfileId)
  // URL errors can mask the missing Dolphin profile in the reader's readiness code.
  const unresolvedProfile = Boolean(row.readinessErrorCode) &&
    !(Number.isFinite(profileId) && profileId > 0)
  if ((row.browser !== undefined && row.browser !== 'dolphin') ||
      unresolvedProfile ||
      /^dolphin_en_profile_(not_found|ambiguous)$/.test(row.readinessErrorCode ?? '')) {
    throw Object.assign(new Error(linkedinBrowserErrorText('linkedin_browser_unsupported')), {
      code: 'linkedin_browser_unsupported'
    })
  }
}

export async function readDolphinAccount(repository: {
  getAccount?(id: number, options: { fresh: boolean }): Promise<any>
  listAccounts(): Promise<any[]>
}, id: number) {
  const row = repository.getAccount ? await repository.getAccount(id, { fresh: true }) :
    (await repository.listAccounts()).find(item => Number(item.platformAccountId) === id)
  if (!row || Number(row.platformAccountId) !== id) {
    throw Object.assign(new Error('LinkedIn account was not found.'), { code: 'linkedin_account_not_found' })
  }
  assertDolphinAccount(row)
  return row
}
