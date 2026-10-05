import type { AsyncLocalStorage as Context } from 'node:async_hooks'
const { AsyncLocalStorage } = require('node:async_hooks') as typeof import('node:async_hooks')
const { randomUUID } = require('node:crypto') as typeof import('node:crypto')
export type RequestInfo = { method: string; operation: string; stage?: string; account?: string; write: boolean; requestId?: string; startedAt?: number; dispatched?: boolean }
export type RequestContext = { taskId?: string; runId?: string; actionId?: string; initiator?: 'schedule' | 'manual' | 'recovery'; account?: string; feature?: string;
  assertWrite?(): Promise<void>; signal?: AbortSignal;
  waitForRequest?<T>(action: () => Promise<T>): Promise<T> }
export type RequestPolicy = { before(info: RequestInfo, context?: RequestContext): Promise<void>;
  queue?<T>(info: RequestInfo, context: RequestContext | undefined, prepare: () => Promise<void>, action: () => Promise<T>): Promise<T>;
  succeeded?(info: RequestInfo, status: number, context?: RequestContext): Promise<void>;
  dispatched?(info: RequestInfo, context?: RequestContext): Promise<void>;
  blocked?(info: RequestInfo, error: unknown, context?: RequestContext): Promise<void>;
  failed(info: RequestInfo, error: unknown, context?: RequestContext): Promise<void> }
const contexts: Context<RequestContext> = new AsyncLocalStorage()
const writes = new Map<string, { promise: Promise<void>; finish(): void }>()
let policy: RequestPolicy | undefined
function installRequestPolicy(value: RequestPolicy) {
  if (policy && policy !== value) throw new Error('linkedin_request_policy_already_installed')
  policy = value
  return () => { if (policy === value) policy = undefined }
}
function requestInfo(method: string, path: string, body?: any): RequestInfo {
  const url = new URL(path, 'https://local.invalid')
  const parts = url.pathname.split('/').filter(Boolean)
  const prefixed = parts.length > 1 && !['accounts', 'users', 'posts', 'search', 'webhooks', 'hosted', 'chats'].includes(parts[0])
  const account = url.searchParams.get('account_id') || (body instanceof FormData
    ? body.get('account_id') : body?.account_id) || (parts[0] === 'accounts' ? parts[1] : prefixed ? parts[0] : undefined)
  // Only operation families are logged; query values and bodies never leave the HTTP client.
  const stage = parts.includes('search') ? (parts.includes('parameters') ? 'search_parameters' : 'people_search') :
    parts.includes('relation-requests') ? (method === 'GET' ? 'invitations_read' : parts.includes('cancel') ? 'invitation_withdraw' : 'invitation_send') :
    parts.includes('relations') ? 'connections_read' :
    parts.includes('reactions') ? (method === 'GET' ? 'likes_read' : 'like_send') :
    parts.includes('comments') ? (method === 'GET' ? 'comments_read' : 'comment_send') :
    parts.includes('posts') ? (method === 'GET' ? 'posts_read' : 'post_send') :
    parts.includes('users') ? (method !== 'GET' ? 'profile_write' : parts.includes('me') ? 'own_profile_read' : 'profile_read') :
    parts.includes('accounts') ? 'account_check' : undefined
  return { method, write: method !== 'GET', account: account ? String(account) : undefined, requestId: randomUUID(), startedAt: Date.now(),
    stage,
    operation: parts.includes('reactions') ? 'likes' : parts.includes('comments') ? 'comments' : parts[prefixed ? 1 : 0] || 'root' }
}
async function beforeRequest(info: RequestInfo) {
  await policy?.before(info, contexts.getStore())
  if (policy && info.write && info.requestId) {
    let finish!: () => void
    const promise = new Promise<void>(resolve => { finish = resolve })
    writes.set(info.requestId, { promise, finish })
  }
}
async function finishRequest(info: RequestInfo, action: () => Promise<void> | undefined) {
  try { await action() } finally {
    if (info.requestId) { writes.get(info.requestId)?.finish(); writes.delete(info.requestId) }
  }
}
async function runRequest<T>(info: RequestInfo, action: () => Promise<T>): Promise<T> {
  const installed = policy, context = contexts.getStore()
  const prepare = async () => {
    try {
      if (policy !== installed) throw new Error('linkedin_request_policy_changed')
      await beforeRequest(info)
      info.startedAt = Date.now()
    } catch (error: any) {
      throw Object.assign(error instanceof Error ? error : new Error('Request blocked.'), { notSent: true })
    }
  }
  try {
    if (installed?.queue) return await installed.queue(info, context, prepare, action)
    await prepare(); return await action()
  } catch (error) {
    if (!info.dispatched) await installed?.blocked?.(info, error, context).catch(() => undefined)
    throw error
  } finally {
    // Also release a write registered in prepare if Stop arrives before dispatch.
    if (info.requestId) { writes.get(info.requestId)?.finish(); writes.delete(info.requestId) }
  }
}
module.exports = { installRequestPolicy, requestInfo,
  hasAccountRequestQueue: () => Boolean(policy?.queue),
  drainWrites: () => Promise.all([...writes.values()].map(value => value.promise)),
  requestContext: () => contexts.getStore(),
  withRequestContext: <T>(value: RequestContext, action: () => T): T => contexts.run({ actionId: randomUUID(), ...contexts.getStore(), ...value }, action),
  beforeRequest, runRequest,
  requestDispatched: async (info: RequestInfo) => { info.dispatched = true; await policy?.dispatched?.(info, contexts.getStore()) },
  requestSucceeded: (info: RequestInfo, status: number) => finishRequest(info, () => policy?.succeeded?.(info, status, contexts.getStore())),
  requestFailed: (info: RequestInfo, error: unknown) => finishRequest(info, () => policy?.failed(info, error, contexts.getStore())) }
