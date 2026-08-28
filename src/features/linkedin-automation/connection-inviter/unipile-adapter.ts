import * as httpClientModule from '../../../integrations/unipile/http-client.ts'
import { randomUUID } from 'node:crypto'
import { createUnipileRequestScheduler } from '../../../integrations/unipile/request-scheduler.ts'
import { NOOP_CONNECTION_LOGGER, type ConnectionLogger } from './logger.ts'

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

export function createConnectionUnipileAdapter(options: {
  http?: any; scheduler?: any; logger?: ConnectionLogger
} = {}) {
  const http = options.http ?? createUnipileHttpClient()
  const scheduler = options.scheduler ?? sharedScheduler
  const logger = options.logger ?? NOOP_CONNECTION_LOGGER
  async function request(operation: string, method: 'GET' | 'POST', path: string, body?: unknown) {
    const started = Date.now(); const operationId = randomUUID()
    logger.event('unipile_request', 'started', { level: 'debug', operation, operationId, attempt: 1 })
    try {
      const value = await scheduler.run(() => http.request(method, path, body))
      logger.event('unipile_request', 'succeeded', { level: 'debug', operation, operationId,
        attempt: 1, durationMs: Date.now() - started, httpStatus: method === 'POST' ? 201 : 200 })
      return value
    } catch (error: any) {
      logger.event('unipile_request', 'failed', { level: 'warn', operation, operationId,
        attempt: 1, durationMs: Date.now() - started,
        errorCode: String(error?.code ?? 'unipile_request_failed') }); throw error
    }
  }
  return {
    getAccount(accountId: string) {
      return request('account_read', 'GET', `/accounts/${encodeURIComponent(accountId)}`)
    },
    getOwnProfile(accountId: string) {
      return request('own_profile_read', 'GET', `/${encodeURIComponent(accountId)}/users/me?` +
        new URLSearchParams({ variant: 'linkedin_classic' }))
    },
    getProfile(accountId: string, personId: string) {
      return request('candidate_profile_read', 'GET',
        `/${encodeURIComponent(accountId)}/users/${encodeURIComponent(personId)}?` +
        new URLSearchParams({ variant: 'linkedin_classic' }))
    },
    listRelations(accountId: string, cursor?: string) {
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : ''
      return request('relations_read', 'GET',
        `/${encodeURIComponent(accountId)}/users/me/relations${query}`)
    },
    searchPeople(accountId: string, keywords: string, cursor?: string) {
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : ''
      return request('people_search', 'POST',
        `/${encodeURIComponent(accountId)}/linkedin/search/people${query}`,
        { keywords, network_distance: [2] })
    },
    listPendingInvitations(accountId: string, offset = 0) {
      const query = new URLSearchParams({ type: 'sent', offset: String(offset) })
      return request('pending_invitations_read', 'GET',
        `/${encodeURIComponent(accountId)}/users/me/relation-requests?${query}`)
    },
    sendInvitation(accountId: string, personId: string) {
      return request('invitation_write', 'POST',
        `/${encodeURIComponent(accountId)}/users/me/relation-requests`, { user_id: personId })
    }
  }
}
