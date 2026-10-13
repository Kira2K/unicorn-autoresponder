import { FEED_QUERY_ID, MAX_HOME_FEED_COUNT } from '../../../integrations/unipile/home-feed.mts'
import type { FeedCard, FeedCursor, FeedPage, FeedRequest } from '../../../integrations/unipile/home-feed.mts'

export type FeedIssue = {
  source: 'Unipile' | 'code'; stage: 'feed_read' | 'feed_parse'; code: string; httpStatus?: number; diagnostic?: string
}
export type FeedSession = {
  version: 1; accountId: string; queryId: string; count: number; startedAt: number; expiresAt: number
  // Absent in older sessions, which retain their fixed page size.
  randomPageSize?: boolean
  batchSize?: number; batchRemaining?: number
  phase: 'ready' | 'reading' | 'waiting' | 'completed' | 'stopped' | 'needs_attention'
  pages: number; attempts: number; ids: string[]; cards?: FeedCard[]; maxPages?: number; cursor?: FeedCursor; nextAt?: number
  reason?: string; error?: FeedIssue
}
export type FeedDependencies = {
  read(input: FeedRequest): Promise<FeedPage>
  // Caller serializes steps for one session; save must durably replace its previous state.
  save(state: FeedSession): Promise<void>
  now(): number; random(): number; signal?: AbortSignal
}
const PAGE_LIMIT = 2, ATTEMPT_LIMIT = 6, DURATION = 30 * 60_000
const MIN_RANDOM_COUNT = 30, MAX_RANDOM_COUNT = 120

function feedRandomInt(random: () => number, min: number, max: number) {
  const value = random()
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('feed_random_invalid')
  return min + Math.floor(value * (max - min + 1))
}
export function feedPause(random: () => number) { return feedRandomInt(random, 60_000, 120_000) }
const terminal = new Set(['completed', 'stopped', 'needs_attention'])
const parseErrors = new Set(['feed_response_invalid', 'feed_graphql_error', 'feed_offset_mismatch',
  'feed_reference_missing', 'feed_item_invalid', 'feed_pagination_missing'])

function validate(state: FeedSession) {
  if (!state || state.version !== 1 || !/^acc_[A-Za-z0-9_-]+$/.test(state.accountId) ||
    !/^voyagerFeedDashMainFeed\.[a-f0-9]{32}$/.test(state.queryId) ||
    !Number.isInteger(state.count) || state.count < 1 || state.count > MAX_HOME_FEED_COUNT ||
    (state.randomPageSize !== undefined && typeof state.randomPageSize !== 'boolean') ||
    (state.batchSize !== undefined && (!state.randomPageSize || !Number.isInteger(state.batchSize) ||
      state.batchSize < MIN_RANDOM_COUNT || state.batchSize > MAX_RANDOM_COUNT || !Number.isInteger(state.batchRemaining) ||
      state.batchRemaining! < 0 || state.batchRemaining! > state.batchSize)) ||
    (state.batchRemaining !== undefined && state.batchSize === undefined) ||
    !Number.isInteger(state.maxPages ?? PAGE_LIMIT) || (state.maxPages ?? PAGE_LIMIT) < 1 || (state.maxPages ?? PAGE_LIMIT) > 4 ||
    !Number.isSafeInteger(state.startedAt) || state.startedAt < 0 || state.expiresAt !== state.startedAt + DURATION ||
    !Number.isInteger(state.pages) || state.pages < 0 || state.pages > (state.maxPages ?? PAGE_LIMIT) ||
    !Number.isInteger(state.attempts) || state.attempts < state.pages || state.attempts > ATTEMPT_LIMIT ||
    !Array.isArray(state.ids) || state.ids.length > (state.maxPages ?? PAGE_LIMIT) * (state.randomPageSize ? MAX_HOME_FEED_COUNT : state.count) ||
    state.ids.some(id => typeof id !== 'string' || !id.startsWith('urn:li:') || id.length > 2_048) ||
    (state.cards !== undefined && (!Array.isArray(state.cards) || state.cards.length > state.ids.length ||
      new Set(state.cards.map(card => card.id)).size !== state.cards.length || state.cards.some(card =>
        !state.ids.includes(card.id) || typeof card.text !== 'string' || typeof card.resharedText !== 'string' ||
        typeof card.sponsored !== 'boolean'))) ||
    !['ready', 'reading', 'waiting', ...terminal].includes(state.phase) ||
    (state.nextAt !== undefined && (!Number.isSafeInteger(state.nextAt) || state.nextAt < state.startedAt)) ||
    (['reading', 'waiting'].includes(state.phase) && (state.nextAt === undefined || state.attempts === 0)) ||
    (state.cursor && (!Number.isSafeInteger(state.cursor.start) || state.cursor.start <= 0 ||
      typeof state.cursor.token !== 'string' || !state.cursor.token.trim() || state.cursor.token.length > 16_384)) ||
    (!terminal.has(state.phase) && state.pages > 0 && !state.cursor)) throw new Error('feed_state_invalid')
}

export function createFeedSession(input: { accountId: string; now: number; count?: number; queryId?: string; maxPages?: number; randomPageSize?: boolean }): FeedSession {
  const state: FeedSession = { version: 1, accountId: input.accountId, queryId: input.queryId ?? FEED_QUERY_ID,
    count: input.count ?? (input.randomPageSize ? MIN_RANDOM_COUNT : 20), startedAt: input.now, expiresAt: input.now + DURATION,
    ...(input.randomPageSize ? { randomPageSize: true } : {}),
    phase: 'ready', pages: 0, attempts: 0, ids: [], cards: [], ...(input.maxPages !== undefined ? { maxPages: input.maxPages } : {}) }
  validate(state)
  return state
}

function failure(state: FeedSession, error: any, now: number): FeedSession {
  const status = error?.details?.httpStatus
  const httpStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status as number : undefined
  const network = ['unipile_timeout', 'unipile_unreachable'].includes(error?.code)
  const sharedWait = error?.code === 'unipile_shared_cooldown'
  const parsing = parseErrors.has(error?.code)
  const code = parsing ? error.code : sharedWait ? 'unipile_shared_cooldown' :
    httpStatus ? `unipile_http_${httpStatus}` : network ? error.code : 'feed_read_failed'
  const diagnostic = error?.details?.graphqlDiagnostic
  const safeDiagnostic = typeof diagnostic === 'string' && diagnostic.length <= 500 &&
    /^errors=\d{1,3}(?:; (?:status=[45]\d\d|type=(?:DataFetchingException|ValidationError|ExecutionAborted|InvalidSyntax)|requested=\d{1,4}))*$/.test(diagnostic)
  const issue: FeedIssue = { code, source: httpStatus || network || sharedWait || code === 'feed_graphql_error' ? 'Unipile' : 'code',
    stage: parsing ? 'feed_parse' : 'feed_read', ...(httpStatus ? { httpStatus } : {}),
    ...(safeDiagnostic ? { diagnostic } : {}) }
  const retryAt = error?.details?.retryAt
  const absolute = Number.isSafeInteger(retryAt) && retryAt >= 0 ? retryAt as number : undefined
  const retriable = httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500) || network || sharedWait
  const fallback = httpStatus === 429 || sharedWait ? 2 * 60 * 60_000 : 5 * 60_000
  return { ...state, error: issue, reason: code, phase: retriable ? 'waiting' : 'needs_attention',
    nextAt: retriable ? Math.max(state.nextAt ?? now, absolute ?? now + fallback) : state.nextAt }
}

/** One bounded read, with durable intent before transport and no sleeping inside the step. */
export async function stepFeedSession(previous: FeedSession, deps: FeedDependencies): Promise<FeedSession> {
  validate(previous)
  let state = structuredClone(previous)
  const save = async () => { await deps.save(structuredClone(state)); return state }
  if (terminal.has(state.phase)) return state
  if (deps.signal?.aborted || deps.now() >= state.expiresAt) {
    state.phase = 'stopped'; state.reason = deps.signal?.aborted ? 'user_stop' : 'session_expired'
    return save()
  }
  if (state.phase === 'reading') {
    // The missing outcome might have contained a long Retry-After. Do not guess it
    // or reread automatically after a crash / failed result save.
    state.phase = 'needs_attention'; state.reason = 'feed_interrupted_read'
    state.error = { source: 'code', stage: 'feed_read', code: 'feed_interrupted_read' }
    return save()
  }
  const pageLimit = state.maxPages ?? PAGE_LIMIT
  if (state.pages >= pageLimit || state.attempts >= ATTEMPT_LIMIT) {
    state.phase = state.pages >= pageLimit ? 'completed' : 'needs_attention'
    state.reason = state.pages >= pageLimit ? 'page_limit' : 'attempt_limit'
    return save()
  }
  if (state.nextAt !== undefined && deps.now() < state.nextAt) return state
  // A failed request retries the same saved page. Larger portions use the same
  // cursor and remaining count over multiple requests, with a pause between them.
  if (state.randomPageSize && !state.error) {
    if (!state.batchRemaining) state.batchRemaining = state.batchSize = feedRandomInt(deps.random, MIN_RANDOM_COUNT, MAX_RANDOM_COUNT)
    state.count = Math.min(MAX_HOME_FEED_COUNT, state.batchRemaining)
  }
  const pause = feedPause(deps.random)
  state = { ...state, phase: 'reading', attempts: state.attempts + 1, nextAt: deps.now() + pause }
  delete state.error; delete state.reason
  await save() // Any storage failure forbids the next request.
  if (deps.signal?.aborted || deps.now() >= state.expiresAt) {
    state.phase = 'stopped'; state.reason = deps.signal?.aborted ? 'user_stop' : 'session_expired'
    return save()
  }
  let page: FeedPage | undefined
  try {
    page = await deps.read({ accountId: state.accountId, queryId: state.queryId, count: state.count,
      cursor: state.cursor, signal: deps.signal })
  } catch (error) { state = failure(state, error, deps.now()) }
  if (page) {
    const newIds = page.ids.filter(id => !state.ids.includes(id))
    if (page.rawCount > 0 && newIds.length === 0) {
      state.phase = 'needs_attention'; state.reason = 'feed_no_progress'
      state.error = { source: 'code', stage: 'feed_parse', code: 'feed_no_progress' }
    } else {
      state.pages++; state.ids.push(...newIds); state.cursor = page.next
      if (state.batchRemaining !== undefined) state.batchRemaining = Math.max(0, state.batchRemaining - page.rawCount)
      state.cards = [...(state.cards ?? []), ...(page.cards ?? []).filter(card => newIds.includes(card.id))]
      state.phase = state.pages >= pageLimit || !page.next ? 'completed' : 'waiting'
      state.reason = !page.next ? 'feed_end' : state.phase === 'completed' ? 'page_limit' : 'page_pause'
      state.nextAt = deps.now() + pause
    }
  }
  // An in-flight read is drained and its outcome saved even when Stop arrives.
  if (deps.signal?.aborted || (deps.now() >= state.expiresAt && state.phase !== 'completed')) {
    state.phase = 'stopped'; state.reason = deps.signal?.aborted ? 'user_stop' : 'session_expired'
  }
  return save() // Persistence errors are not provider errors and must escape to the caller.
}
