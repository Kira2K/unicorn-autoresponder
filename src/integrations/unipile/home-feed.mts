import { createRequire } from 'node:module'
const requestControl = createRequire(import.meta.url)('./request-control.ts')
const { withRequestContext } = requestControl
export const MAX_HOME_FEED_COUNT: number = requestControl.MAX_HOME_FEED_COUNT

export const FEED_QUERY_ID = 'voyagerFeedDashMainFeed.7a50ef8ba5a7865c23ad5df46f735709'

export type FeedCursor = { start: number; token: string }
export type FeedCard = {
  id: string; text: string; resharedText: string; sponsored: boolean
  authorId?: string; canReact?: boolean; canComment?: boolean; reacted?: boolean
}
export type FeedPage = { ids: string[]; rawCount: number; cards?: FeedCard[]; next?: FeedCursor }
export type FeedRequest = {
  accountId: string; count?: number; queryId?: string; cursor?: FeedCursor; signal?: AbortSignal
}
type Transport = {
  request(method: 'POST', path: string, body: unknown, options: { expectedStatus: number }): Promise<unknown>
}

function fail(code: string): never { throw Object.assign(new Error(code), { code }) }
function record(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}
function token(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function graphqlFailure(errors: unknown[]): never {
  // Raw GraphQL messages may contain reflected data. Retain bounded, known metadata only.
  const diagnostic = [`errors=${Math.min(errors.length, 999)}`]
  for (const value of errors.slice(0, 3)) {
    const error = record(value), status = error?.extensions?.status, classification = error?.extensions?.classification
    if (Number.isInteger(status) && status >= 400 && status <= 599) diagnostic.push(`status=${status}`)
    if (['DataFetchingException', 'ValidationError', 'ExecutionAborted', 'InvalidSyntax'].includes(classification))
      diagnostic.push(`type=${classification}`)
    const count = typeof error?.message === 'string' && error.message.match(/^Too many elements requested \((\d{1,4})\)$/)
    if (count) diagnostic.push(`requested=${count[1]}`)
  }
  throw Object.assign(new Error('feed_graphql_error'), { code: 'feed_graphql_error',
    details: { graphqlDiagnostic: diagnostic.join('; ') } })
}

/** Raw API envelope is POST, but the only permitted LinkedIn operation here is a feed GET. */
export function createHomeFeedReader(client: Transport) {
  return async function readHomeFeed(input: FeedRequest): Promise<FeedPage> {
    const { accountId, cursor } = input
    const count = input.count ?? 20, queryId = input.queryId ?? FEED_QUERY_ID
    if (!/^acc_[A-Za-z0-9_-]+$/.test(accountId) || !Number.isInteger(count) || count < 1 || count > MAX_HOME_FEED_COUNT ||
      !/^voyagerFeedDashMainFeed\.[a-f0-9]{32}$/.test(queryId) ||
      (cursor && (!Number.isSafeInteger(cursor.start) || cursor.start <= 0 ||
        typeof cursor.token !== 'string' || !cursor.token.trim() || cursor.token.length > 16_384))) fail('feed_input_invalid')
    input.signal?.throwIfAborted()
    const start = cursor?.start ?? 0
    const variables = `(start:${start},count:${count}${cursor ? `,paginationToken:${token(cursor.token)}` : ''})`
    const raw = record(await withRequestContext(input.signal ? { signal: input.signal } : {}, () =>
      client.request('POST', `/${accountId}/linkedin/`, {
        method: 'GET', url: 'https://www.linkedin.com/voyager/api/graphql', bypass_url_encoding: true,
        query_params: { queryId, variables }
      }, { expectedStatus: 200 })))
    const payload = record(raw?.data)
    const errors = [payload?.errors, payload?.data?.errors].flatMap(value => Array.isArray(value) ? value : [])
    if (errors.length) graphqlFailure(errors)
    if (payload?.errors?.length || payload?.data?.errors?.length) fail('feed_graphql_error')
    if (raw?.object !== 'LinkedInRawResponse' || !payload) fail('feed_response_invalid')
    const feed = record(payload.data?.feedDashMainFeedByMainFeed)
    const elements: unknown = feed?.elements ?? feed?.['*elements']
    if (!feed || !Array.isArray(elements) || elements.length > count) fail('feed_response_invalid')
    if (feed.paging?.start !== undefined && feed.paging.start !== start) fail('feed_offset_mismatch')
    const included = new Map<string, Record<string, any>>()
    for (const item of Array.isArray(payload.included) ? payload.included : []) {
      if (record(item) && typeof item.entityUrn === 'string') included.set(item.entityUrn, item)
    }
    const cards: FeedCard[] = elements.map(element => {
      const item = typeof element === 'string' ? included.get(element) : record(element)
      if (typeof element === 'string' && !item) fail('feed_reference_missing')
      if (!item || typeof item.entityUrn !== 'string' || !item.entityUrn.startsWith('urn:li:') ||
        item.entityUrn.length > 2_048) fail('feed_item_invalid')
      const social = item.socialDetail ?? {}, permissions = social.socialPermissions ?? {}
      const counts = social.totalSocialActivityCounts ?? {}
      const rawId = item.entityUrn as string
      // MAIN_FEED wrappers differ between pages; the underlying activity is the same post.
      const id = rawId.match(/urn:li:activity:\d+(?=[^\d]|$)/)?.[0] ?? rawId
      const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 30_000) : ''
      return { id, text: text(item.commentary?.text?.text), resharedText: text(item.resharedUpdate?.commentary?.text?.text),
        sponsored: Boolean(item.metadata?.trackingData?.sponsoredTracking || item.commentary?.navigationContext?.sponsoredUrlAttributes),
        ...(typeof item.actor?.backendUrn === 'string' ? { authorId: item.actor.backendUrn } : {}),
        ...(typeof permissions.canReact === 'boolean' ? { canReact: permissions.canReact } : {}),
        ...(typeof permissions.canPostComments === 'boolean' ? { canComment: permissions.canPostComments } : {}),
        ...(typeof counts.liked === 'boolean' ? { reacted: counts.liked || !!counts.reacted } : {}) }
    })
    const nextStart = start + elements.length
    const atEnd = elements.length === 0 || (Number.isSafeInteger(feed.paging?.total) && feed.paging.total <= nextStart)
    const nextToken = feed.metadata?.paginationToken
    if (!atEnd && (typeof nextToken !== 'string' || !nextToken.trim() || nextToken.length > 16_384)) fail('feed_pagination_missing')
    const unique = [...new Map(cards.map(card => [card.id, card])).values()]
    return { ids: unique.map(card => card.id), cards: unique, rawCount: elements.length,
      ...(!atEnd ? { next: { start: nextStart, token: nextToken } } : {}) }
  }
}
