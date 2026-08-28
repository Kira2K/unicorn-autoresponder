import * as httpClientModule from '../../../integrations/unipile/http-client.ts'
import { createUnipileRequestScheduler } from '../../../integrations/unipile/request-scheduler.ts'

const { createUnipileHttpClient } = httpClientModule as unknown as {
  createUnipileHttpClient(options?: any): any
}
const sharedScheduler = createUnipileRequestScheduler()

export function connectionPageItems(value: any): any[] {
  return Array.isArray(value) ? value : value?.items ?? value?.data ?? value?.list ?? []
}

export function connectionNextCursor(value: any): string {
  return String(value?.next_cursor ?? value?.cursor ?? '').trim()
}

export function invitationRequestId(value: any): string | undefined {
  const result = value?.data ?? value
  return String(result?.request_id ?? result?.id ?? result?.relation_request_id ?? '').trim() || undefined
}

export function pendingPersonId(value: any): string {
  const person = value?.user ?? value?.sender ?? value?.recipient ?? value?.invitee ?? value
  return String(person?.provider_id ?? person?.user_id ?? person?.id ?? value?.user_id ?? '').trim()
}

export function createConnectionUnipileAdapter(options: { http?: any; scheduler?: any } = {}) {
  const http = options.http ?? createUnipileHttpClient()
  const scheduler = options.scheduler ?? sharedScheduler
  const read = (method: 'GET' | 'POST', path: string, body?: unknown) =>
    scheduler.run(() => http.request(method, path, body))
  return {
    getAccount(accountId: string) {
      return read('GET', `/accounts/${encodeURIComponent(accountId)}`)
    },
    getOwnProfile(accountId: string) {
      return read('GET', `/${encodeURIComponent(accountId)}/users/me?` +
        new URLSearchParams({ variant: 'linkedin_classic' }))
    },
    getProfile(accountId: string, personId: string) {
      return read('GET', `/${encodeURIComponent(accountId)}/users/${encodeURIComponent(personId)}?` +
        new URLSearchParams({ variant: 'linkedin_classic' }))
    },
    listRelations(accountId: string, cursor?: string) {
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : ''
      return read('GET', `/${encodeURIComponent(accountId)}/users/me/relations${query}`)
    },
    searchPeople(accountId: string, keywords: string, cursor?: string) {
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : ''
      return read('POST', `/${encodeURIComponent(accountId)}/linkedin/search/people${query}`,
        { keywords, network_distance: [2] })
    },
    listPendingInvitations(accountId: string, offset = 0) {
      const query = new URLSearchParams({ type: 'sent', offset: String(offset) })
      return read('GET', `/${encodeURIComponent(accountId)}/users/me/relation-requests?${query}`)
    },
    sendInvitation(accountId: string, personId: string) {
      return scheduler.run(() => http.request('POST',
        `/${encodeURIComponent(accountId)}/users/me/relation-requests`, { user_id: personId }))
    }
  }
}
