import * as httpModule from './http-client.ts'
import * as validationModule from '../../features/linkedin-automation/account-connection/account-validation.ts'
import type { Provider } from '../../features/linkedin-automation/invitation-withdrawal/contracts.ts'
import { readAllSentInvitations } from './sent-invitations.ts'
const { createUnipileHttpClient } = httpModule as unknown as { createUnipileHttpClient(): Http }
const { assertAccountOperational, verifiedIdentity } = validationModule as unknown as {
  assertAccountOperational(value: any): void; verifiedIdentity(account: any, own: any, target: any): unknown }
type Http = { request(method: 'GET' | 'POST', path: string, body?: unknown, options?: any): Promise<any> }
export function createWithdrawalProvider(http: Http = createUnipileHttpClient()): Provider {
  const request = (method: 'GET' | 'POST', path: string) =>
    http.request(method, path, undefined, { noCache: true, fullRetryAfter: true })
  return {
    async verify(account) {
      const id = encodeURIComponent(account.accountId)
      const remote = await request('GET', `/accounts/${id}`)
      if (remote?.id !== account.accountId) throw new Error('Unipile account mismatch')
      assertAccountOperational(remote)
      const own = await request('GET', `/${id}/users/me?variant=linkedin_classic`)
      verifiedIdentity(remote, own, { expectedLinkedInUrl: account.linkedinUrl,
        verifiedProviderId: account.verifiedProviderId })
    },
    list(accountId) {
      return readAllSentInvitations(offset => request('GET',
        `/${encodeURIComponent(accountId)}/users/me/relation-requests?` +
        new URLSearchParams({ type: 'sent', limit: '100', offset: String(offset) })))
    },
    async cancel(accountId, requestId) {
      const result = await request('POST', `/${encodeURIComponent(accountId)}/users/me/relation-requests/` +
        `${encodeURIComponent(requestId)}/cancel`)
      if (result?.object !== 'RelationRequestCanceled') throw new Error('Withdrawal response is uncertain')
    }
  }
}
