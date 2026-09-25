import * as httpClientModule from '../../../integrations/unipile/http-client.ts'
import { randomUUID } from 'node:crypto'
import { createUnipileRequestScheduler } from '../../../integrations/unipile/request-scheduler.ts'
import { NOOP_CONNECTION_LOGGER, type ConnectionLogger,
  captureConnectionRequestTrace, recordConnectionRequest } from './logger.ts'
import { retryableUnipileRead } from '../../../integrations/unipile/read-retry.ts'
import { unipileRateLimitSource } from './errors.ts'
import type { UnipileResponseMetadata } from '../../../integrations/unipile/http-client.ts'

const { createUnipileHttpClient } = httpClientModule as unknown as {
  createUnipileHttpClient(options?: any): any
}
// Keep consecutive requests below ten per minute, including page reads.
export const CONNECTION_MIN_REQUEST_INTERVAL_MS = 6_500
export const connectionRequestDelay = (random: () => number = Math.random) =>
  CONNECTION_MIN_REQUEST_INTERVAL_MS + Math.floor(Math.min(1, Math.max(0, random())) * 4_500)
const sharedScheduler = createUnipileRequestScheduler({ minIntervalMs: connectionRequestDelay })
const PENDING_INVITATIONS_PAGE_LIMIT = 100

export function connectionPageItems(value: any): any[] {
  return Array.isArray(value) ? value : value?.items ?? value?.data ?? value?.list ?? []
}

export function connectionNextCursor(value: any): string {
  return String(value?.next_cursor ?? value?.cursor ?? '').trim()
}

export function parseConnectionPeopleSearchResponse(value: any) {
  if (Array.isArray(value)) return { items: value, nextCursor: '', responseShape: 'array' }
  if (value && Array.isArray(value.items)) return { items: value.items,
    nextCursor: connectionNextCursor(value), responseShape: 'items' }
  if (value && Array.isArray(value.data)) return { items: value.data,
    nextCursor: connectionNextCursor(value), responseShape: 'data' }
  if (value?.data && Array.isArray(value.data.items)) return { items: value.data.items,
    nextCursor: connectionNextCursor(value.data) || connectionNextCursor(value),
    responseShape: 'data.items' }
  throw Object.assign(new Error('Unexpected Unipile Classic people search response.'), {
    code: 'connection_search_response_invalid'
  })
}

export function invitationRequestId(value: any): string | undefined {
  const result = value?.data ?? value
  return String(result?.request_id ?? result?.id ?? result?.relation_request_id ?? '').trim() || undefined
}

// Only a complete V2 profile describes the absence of an optional relation request.
// Legacy/partial profiles still use the full pending-list fallback.
function completeInvitationProfile(value: any, personId: string) {
  const details = value?.specifics
  const relation = details?.relation_request
  return value?.object === 'UserProfile' && value.id === personId && value.provider === 'linkedin' &&
    value.type === 'individual' && typeof value.display_name === 'string' && Boolean(value.display_name.trim()) &&
    typeof value.is_blocked === 'boolean' &&
    ['FIRST_DEGREE', 'SECOND_DEGREE', 'THIRD_DEGREE', 'OUT_OF_NETWORK'].includes(details?.network_distance) &&
    (details.relation_request_status === undefined ||
      ['PENDING', 'IGNORED', 'WITHDRAWN'].includes(details.relation_request_status)) &&
    (relation === undefined || (relation?.object === 'RelationRequest' &&
      ['sent', 'received'].includes(relation.type) && typeof relation.id === 'string' && relation.id.trim()))
}

export function confirmedInvitationReceipt(value: any, accountId: string, personId: string) {
  const receipt = value?.receipt
  return receipt?.accountId === accountId && receipt.personId === personId &&
    typeof receipt.requestId === 'string' && receipt.requestId === invitationRequestId(value)
    ? receipt.requestId : undefined
}

export function pendingPersonId(value: any): string {
  // V2 exposes the target as user.id. Legacy sent-invitation shapes may include both
  // sender=self and recipient=target, so recipient/invitee must win over sender.
  const person = value?.user ?? value?.recipient ?? value?.invitee
  if (person) return String(person?.provider_id ?? person?.user_id ?? person?.id ?? '').trim()
  // Top-level `id` is commonly the invitation/request ID, not the LinkedIn person ID.
  return String(value?.provider_id ?? value?.user_id ?? '').trim()
}

export function parseConnectionPendingResponse(value: any) {
  let items: any[] | undefined
  let responseShape: string | undefined
  let envelope: any = value
  if (Array.isArray(value)) { items = value; responseShape = 'array' }
  else if (value && Array.isArray(value.items)) { items = value.items; responseShape = 'items' }
  else if (value && Array.isArray(value.data)) { items = value.data; responseShape = 'data' }
  else if (value && Array.isArray(value.list)) { items = value.list; responseShape = 'list' }
  else if (value?.data && Array.isArray(value.data.items)) {
    items = value.data.items; responseShape = 'data.items'; envelope = value.data
  }
  if (!items || items.some(item => !pendingPersonId(item))) {
    throw Object.assign(new Error('Unexpected Unipile pending invitations response.'), {
      code: 'unipile_pending_response_invalid', details: { httpStatus: 503 }
    })
  }
  const nextCursor = connectionNextCursor(envelope) || connectionNextCursor(value) || undefined
  const rawTotal = envelope?.total_count ?? envelope?.total ??
    value?.total_count ?? value?.total
  const totalProvided = rawTotal !== undefined && rawTotal !== null && rawTotal !== ''
  const parsedTotal = rawTotal === undefined || rawTotal === null || rawTotal === ''
    ? undefined : Number(rawTotal)
  const totalCount = parsedTotal !== undefined && Number.isInteger(parsedTotal) && parsedTotal >= 0
    ? parsedTotal : undefined
  const hasMore = envelope?.has_more ?? value?.has_more
  if ((totalProvided && totalCount === undefined) ||
    (hasMore !== undefined && typeof hasMore !== 'boolean')) {
    throw Object.assign(new Error('Unexpected Unipile pending invitations pagination metadata.'), {
      code: 'unipile_pending_response_invalid', details: { httpStatus: 503 }
    })
  }
  return { items, responseShape: responseShape!,
    ...(nextCursor ? { nextCursor } : {}),
    ...(totalCount !== undefined ? { totalCount } : {}),
    ...(typeof hasMore === 'boolean' ? { hasMore } : {}) }
}

export function createConnectionUnipileAdapter(options: {
  http?: any; scheduler?: any; logger?: ConnectionLogger; maxReadAttempts?: number; now?: () => number
} = {}) {
  const http = options.http ?? createUnipileHttpClient({ retryAfterCapMs: Number.POSITIVE_INFINITY })
  const scheduler = options.scheduler ?? sharedScheduler
  const logger = options.logger ?? NOOP_CONNECTION_LOGGER
  const maxReadAttempts = Math.max(1, options.maxReadAttempts ?? 1)
  const now = options.now ?? Date.now
  let requestNumber = 0
  async function request(operation: string, method: 'GET' | 'POST', path: string, body?: unknown,
    successStatus = 200, observe?: (metadata: UnipileResponseMetadata) => void) {
    const operationId = randomUUID()
    const trace = captureConnectionRequestTrace()
    const attribution = { ...trace?.details, retryAttempt: trace?.retryAttempt ?? 1 }
    for (let attempt = 1; attempt <= (method === 'GET' ? maxReadAttempts : 1); attempt += 1) {
      const queuedAt = Date.now()
      try {
        const value = await scheduler.run(async () => {
          const started = Date.now()
          const currentRequestNumber = ++requestNumber
          const counts = recordConnectionRequest(trace, operation,
            ['pending_invitations_read', 'people_search', 'relations_read'].includes(operation), attempt)
          let metadata: UnipileResponseMetadata | undefined
          logger.event('unipile_request', 'started', { level: 'debug', operation, operationId,
            ...attribution, attempt, requestNumber: currentRequestNumber, queueWaitMs: started - queuedAt })
          try {
            const result = await http.request(method, path, body, {
              onResponse(value: UnipileResponseMetadata) {
                metadata = value
                observe?.(value)
                if (counts && value.providerCache === 'HIT') counts.providerCacheHits++
                if (counts && value.providerCache === 'MISS') counts.providerCacheMisses++
              }
            })
            logger.event('unipile_request', 'succeeded', { level: 'debug', operation, operationId,
              attempt, requestNumber: currentRequestNumber, durationMs: Date.now() - started,
              httpStatus: successStatus, ...metadata, ...attribution })
            return result
          } catch (error: any) {
            if (counts) counts.failures++
            const willRetry = method === 'GET' && attempt < maxReadAttempts &&
              retryableUnipileRead(error)
            const rateLimitSource = unipileRateLimitSource(error)
            const retryAfterMs = Number(error?.details?.retryAfterMs)
            logger.event('unipile_request', 'failed', { level: 'warn', operation, operationId,
              ...metadata, ...attribution,
              attempt, requestNumber: currentRequestNumber, durationMs: Date.now() - started,
              errorCode: String(error?.code ?? 'unipile_request_failed'), willRetry,
              ...(rateLimitSource ? { rateLimitSource } : {}),
              ...(Number.isFinite(retryAfterMs) ? { retryAfterMs } : {}) })
            throw error
          }
        })
        return value
      } catch (error: any) {
        const willRetry = method === 'GET' && attempt < maxReadAttempts && retryableUnipileRead(error)
        if (!willRetry) throw error
      }
    }
    throw new Error('Unipile read attempts exhausted.')
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
    async getInvitationProfile(accountId: string, personId: string) {
      const startedAt = now()
      let metadata: UnipileResponseMetadata | undefined
      const profile = await request('candidate_profile_read', 'GET',
        `/${encodeURIComponent(accountId)}/users/${encodeURIComponent(personId)}?` +
        new URLSearchParams({ variant: 'linkedin_classic' }), undefined, 200, value => { metadata = value })
      const cache = metadata?.providerCache
      const age = metadata?.providerCacheAgeSeconds
      const knownFresh = cache === 'MISS' || cache === 'BYPASS' ||
        (cache === 'HIT' && age !== undefined)
      return { profile, accountId, personId,
        ...(metadata?.httpStatus === 200 && knownFresh && completeInvitationProfile(profile, personId)
          ? { pendingStateObservedAt: startedAt - (age ?? 0) * 1000 } : {}) }
    },
    listRelations(accountId: string, cursor?: string) {
      const query = `?${new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) })}`
      return request('relations_read', 'GET',
        `/${encodeURIComponent(accountId)}/users/me/relations${query}`)
    },
    resolveLocations(accountId: string, city: string) {
      const query = new URLSearchParams({ type: 'LOCATION', keywords: city, offset: '0', limit: '10' })
      return request('location_lookup', 'GET',
        `/${encodeURIComponent(accountId)}/linkedin/search/parameters?${query}`)
    },
    searchPeople(accountId: string, input: { keywords: string; locationId: string }, cursor?: string) {
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : ''
      return request('people_search', 'POST',
        `/${encodeURIComponent(accountId)}/linkedin/search/people${query}`,
        { keywords: input.keywords, location: [input.locationId], network_distance: [2] })
    },
    listPendingInvitations(accountId: string, page: number | string = 0) {
      const query = new URLSearchParams({
        type: 'sent', limit: String(PENDING_INVITATIONS_PAGE_LIMIT)
      })
      if (typeof page === 'string') query.set('cursor', page)
      else query.set('offset', String(page))
      return request('pending_invitations_read', 'GET',
        `/${encodeURIComponent(accountId)}/users/me/relation-requests?${query}`)
    },
    async sendInvitation(accountId: string, personId: string) {
      let status: number | undefined
      const data = await request('invitation_write', 'POST',
        `/${encodeURIComponent(accountId)}/users/me/relation-requests`, { user_id: personId }, 201,
        metadata => { status = metadata.httpStatus })
      const body = data as any
      const valid = status === 201 && body?.object === 'RelationRequest' && body.type === 'sent' &&
        typeof body.id === 'string' && body.id.trim() &&
        (body.user === undefined || body.user?.id === personId)
      return { data, ...(valid ? { receipt: { accountId, personId, requestId: body.id } } : {}) }
    }
  }
}
