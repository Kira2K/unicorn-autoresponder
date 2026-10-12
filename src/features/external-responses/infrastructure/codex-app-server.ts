import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'

type RpcProcess = Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr' | 'once' | 'kill'>
type RpcResult = { id?: number; result?: any; error?: unknown }
export type OwnedTurn = { ownerToken: string; threadId: string; turnId: string }
export type OwnedThread = { ownerToken: string; threadId: string }
export type OwnedNotification = { method: string; params: unknown; ownedTurn?: OwnedTurn }

const validId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,200}$/.test(value)

/** Allowlisted diagnostics only: never persist upstream messages, account IDs or URLs. */
export function safeRpcFailure(error: unknown) {
  const e=error as Error & {rpcCode?:number;httpStatus?:number;rpcMethod?:string;rpcCategory?:string}
  const category=e?.message==='codex_app_server_auth_required'?'authentication':e?.message==='codex_app_server_timeout'?'timeout':
    ['network','http','rpc'].includes(e?.rpcCategory??'')?e.rpcCategory!:e?.message==='codex_app_server_closed'?'closed':'unknown'
  return {category,...(Number.isInteger(e?.rpcCode)?{rpcCode:e.rpcCode}:{}),
    ...(Number.isInteger(e?.httpStatus)&&e.httpStatus!>=400&&e.httpStatus!<=599?{httpStatus:e.httpStatus}:{}),
    ...(['initialize','account/rateLimits/read'].includes(e?.rpcMethod??'')?{method:e.rpcMethod}:{})}
}

function rpcError(method:string,raw:unknown) {
  const text=JSON.stringify(raw),code=(raw as any)?.code
  const auth=/authentication required|unauthorized|\b401\b|\b403\b/i.test(text)
  const status=Number(/\b(?:status(?: code)?|HTTP)\D{0,8}([45]\d\d)\b/i.exec(text)?.[1])
  return Object.assign(Error(auth?'codex_app_server_auth_required':'codex_app_server_rpc_error'),{
    rpcMethod:method,...(Number.isInteger(code)?{rpcCode:code}:{}),...(status?{httpStatus:status}:{}),
    rpcCategory:/timeout|timed out|connect|network|error sending request|dns/i.test(text)?'network':status?'http':'rpc'})
}

/** Minimal App Server client. Its public surface cannot issue arbitrary RPC methods or interrupt unowned work. */
export function createCodexAppServer(options: {
  executable?: string
  spawn?: (executable: string, args: string[], options: { stdio: 'pipe'; windowsHide: true }) => RpcProcess
  requestTimeoutMs?: number
  quotaTimeoutMs?: number
  onNotification?: (notification: OwnedNotification) => void
} = {}) {
  const child = (options.spawn ?? ((exe, args, opts) => nodeSpawn(exe, args, opts)))
    (options.executable ?? 'codex', ['app-server', '--listen', 'stdio://'], { stdio: 'pipe', windowsHide: true })
  const pending = new Map<number, { method:string;resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  const ownedThreads = new Map<string, OwnedThread>(), owned = new Map<string, OwnedTurn>(), reader = createInterface({ input: child.stdout })
  let nextId = 1, initialized: Promise<void> | undefined, closed = false
  const fail = (error: Error) => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error) }; pending.clear() }
  reader.on('line', line => {
    let message: RpcResult & { method?: string; params?: any }
    try { message = JSON.parse(line) } catch { return }
    if (message.id === undefined && message.method && options.onNotification) {
      const threadId = message.params?.threadId ?? message.params?.thread?.id ?? message.params?.turn?.threadId
      const turnId = message.params?.turnId ?? message.params?.turn?.id
      if (validId(threadId) && ownedThreads.has(threadId)) {
        const registered = validId(turnId) ? owned.get(`${threadId}\0${turnId}`) : undefined
        // Forward instance-owned thread events even when a turn event races its turn/start response.
        options.onNotification({ method: message.method, params: message.params,
          ...(registered ? { ownedTurn: structuredClone(registered) } : {}) })
      }
      return
    }
    if (!Number.isInteger(message.id)) return
    const entry = pending.get(message.id!); if (!entry) return
    pending.delete(message.id!); clearTimeout(entry.timer)
    if (message.error) entry.reject(rpcError(entry.method,message.error))
    else entry.resolve(message.result)
  })
  child.once('error', () => fail(Error('codex_app_server_unavailable')))
  child.once('exit', () => fail(Error('codex_app_server_closed')))
  child.stdin.once('error', () => fail(Error('codex_app_server_write_failed')))
  child.stderr.resume()
  const send = (method: string, params?: unknown,timeoutMs=options.requestTimeoutMs??15_000) => new Promise<any>((resolve, reject) => {
    if (closed) return reject(Error('codex_app_server_closed'))
    const id = nextId++, timer = setTimeout(() => { pending.delete(id); reject(Object.assign(Error('codex_app_server_timeout'),{rpcMethod:method})) }, timeoutMs)
    pending.set(id, { method,resolve, reject, timer })
    child.stdin.write(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }) + '\n', error => {
      if (error) { clearTimeout(timer); pending.delete(id); reject(Error('codex_app_server_write_failed')) }
    })
  })
  const notify = (method: string, params?: unknown) => child.stdin.write(JSON.stringify({ method, ...(params === undefined ? {} : { params }) }) + '\n')
  const initialize = () => initialized ??= (async () => {
    await send('initialize', { clientInfo: { name: 'external_responses_budget', version: '1.0.0' }, capabilities: { experimentalApi: true } })
    notify('initialized', {})
  })()
  const readPrimaryRateLimit = async () => { await initialize(); return send('account/rateLimits/read',undefined,options.quotaTimeoutMs??options.requestTimeoutMs??5_000) }
  const readAccount = async () => { await initialize(); return send('account/read', { refreshToken: false }) }
  const readModels = async () => {
    await initialize()
    const models: any[] = [], seen = new Set<string>()
    let cursor: string | undefined
    do {
      const page = await send('model/list', { limit: 100, ...(cursor ? { cursor } : {}) })
      if (!Array.isArray(page?.data)) throw Error('codex_model_catalog_invalid')
      models.push(...page.data)
      cursor = page.nextCursor ?? undefined
      if (cursor !== undefined && (typeof cursor !== 'string' || seen.has(cursor) || seen.size >= 10)) throw Error('codex_model_catalog_pagination_invalid')
      if (cursor) seen.add(cursor)
    } while (cursor)
    return models
  }
  const startOwnedThread = async (ownerToken: string, params: Record<string, unknown> = {}) => {
    if (!validId(ownerToken)) throw Error('invalid_owned_thread_identity')
    await initialize()
    const result = await send('thread/start', params), threadId = result?.thread?.id ?? result?.threadId
    if (!validId(threadId)) throw Error('thread_start_missing_identity')
    const ref = { ownerToken, threadId }; ownedThreads.set(threadId, ref)
    return { result, ownedThread: structuredClone(ref) }
  }
  const startOwnedTurn = async (ownerToken: string, params: Record<string, unknown>) => {
    if (!validId(ownerToken) || !validId(params.threadId)) throw Error('invalid_owned_turn_identity')
    if (ownedThreads.get(params.threadId as string)?.ownerToken !== ownerToken) throw Error('owned_thread_mismatch')
    await initialize()
    const result = await send('turn/start', params), turnId = result?.turn?.id ?? result?.turnId
    if (!validId(turnId)) throw Error('turn_start_missing_identity')
    const ref = { ownerToken, threadId: params.threadId as string, turnId }, key = `${ref.threadId}\0${ref.turnId}`
    owned.set(key, ref); return { result, ownedTurn: structuredClone(ref) }
  }
  const interruptOwnedTurn = async (ref: OwnedTurn) => {
    const key = `${ref.threadId}\0${ref.turnId}`, registered = owned.get(key)
    if (!registered || registered.ownerToken !== ref.ownerToken) throw Error('owned_turn_mismatch')
    await initialize(); await send('turn/interrupt', { threadId: ref.threadId, turnId: ref.turnId }); owned.delete(key)
  }
  const close = async () => {
    if (closed) return
    closed = true; reader.close(); child.stdin.end(); fail(Error('codex_app_server_closed'))
    child.kill()
    // On Windows a child descendant can inherit these pipes and keep Node alive
    // after the owned App Server exits. Detach only this client's streams.
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy()
  }
  return { readPrimaryRateLimit, readAccount, readModels, startOwnedThread, startOwnedTurn, interruptOwnedTurn, close }
}

export const newOwnerToken = () => randomUUID()
