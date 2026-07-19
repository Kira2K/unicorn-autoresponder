const crypto = require('node:crypto')

type TelegramGatewayOperation =
  | 'list_admin_senders'
  | 'status'
  | 'folders'
  | 'dialogs'
  | 'messages'
  | 'scan_admin_dialogs'
  | 'send'
  | 'send_to_username'
  | 'rename_contact'
  | 'connect'
  | 'reauth'
  | 'disconnect'

type TelegramServiceLike = {
  connect(clientId: number, input: Record<string, any>): Promise<unknown>
  status(clientId: number, accountId?: number, options?: { signal?: AbortSignal }): Promise<unknown>
  folders(clientId: number, accountId?: number, options?: { signal?: AbortSignal }): Promise<unknown>
  dialogs(clientId: number, input?: Record<string, any>): Promise<unknown>
  scanAdminDialogs(clientId: number, input: Record<string, any>): Promise<unknown>
  messages(clientId: number, input: Record<string, any>): Promise<unknown>
  send(clientId: number, input: Record<string, any>): Promise<unknown>
  listAdminSenders(options?: { signal?: AbortSignal }): Promise<unknown>
  sendToUsername(clientId: number, input: Record<string, any>): Promise<unknown>
  renameContact(clientId: number, input: Record<string, any>): Promise<unknown>
  reauth(clientId: number, accountId?: number): Promise<unknown>
  disconnect(clientId: number, accountId?: number): Promise<unknown>
}

type GatewayEnvironment = Record<string, string | undefined>

const GATEWAY_RPC_PATH = '/api/internal/telegram-gateway/rpc'
const GATEWAY_HEALTH_PATH = '/api/internal/telegram-gateway/health'
const MIN_GATEWAY_TOKEN_LENGTH = 32

const OPERATIONS = new Set<TelegramGatewayOperation>([
  'list_admin_senders',
  'status',
  'folders',
  'dialogs',
  'messages',
  'scan_admin_dialogs',
  'send',
  'send_to_username',
  'rename_contact',
  'connect',
  'reauth',
  'disconnect'
])

const WRITE_OPERATIONS = new Set<TelegramGatewayOperation>([
  'send',
  'send_to_username',
  'rename_contact'
])

const AUTH_MUTATION_OPERATIONS = new Set<TelegramGatewayOperation>([
  'connect',
  'reauth'
])

const SERVER_LOCAL_KEYS = new Set([
  'dbPath',
  'databasePath',
  'telegramTdlibDbPath',
  'eventLog',
  'telegramEventLog',
  'phone',
  'password',
  'proxy',
  'path',
  'filePath'
])

const SAFE_ERROR_MESSAGES: Record<string, string> = {
  telegram_gateway_not_configured: 'The Render Telegram gateway is not configured.',
  telegram_gateway_invalid_request: 'The Telegram gateway request is invalid.',
  telegram_gateway_invalid_operation: 'The requested Telegram gateway operation is not supported.',
  telegram_gateway_operation_forbidden: 'This Telegram operation is disabled by the gateway configuration.',
  telegram_gateway_cancelled: 'The Telegram gateway request was cancelled.',
  telegram_gateway_timeout: 'The Render Telegram gateway did not answer before the configured timeout.',
  telegram_gateway_unavailable: 'The Render Telegram gateway is unavailable.',
  telegram_gateway_invalid_response: 'The Render Telegram gateway returned an invalid response.',
  telegram_gateway_operation_failed: 'The Render Telegram operation failed.',
  telegram_account_not_found: 'Telegram platform account was not found.',
  telegram_readonly: 'Telegram writing is disabled.',
  telegram_invalid_username: 'The Telegram username is invalid.',
  telegram_empty_message: 'Message text or an attachment is required.',
  telegram_sender_inactive: 'The selected Telegram account is not active.',
  telegram_attachment_missing: 'A Telegram attachment is missing.',
  telegram_attachment_invalid: 'A Telegram attachment is invalid.',
  telegram_connecting: 'The Telegram session is still initializing.',
  telegram_tdlib_timeout: 'TDLib did not answer before the request timeout.',
  telegram_file_send_failed: 'Telegram could not send the attachment.',
  telegram_auth_code_required: 'The Telegram account requires an authorization code.',
  telegram_password_required: 'The Telegram account requires its cloud password.',
  telegram_authorization_failed: 'Telegram authorization failed.',
  telegram_tdlib_database_locked: 'The Telegram account database is already in use.',
  telegram_proxy_unavailable: 'The assigned Telegram proxy is unavailable.',
  telegram_dialog_scan_cancelled: 'Telegram dialog scanning was cancelled.',
  telegram_dialog_scan_timeout: 'Telegram dialog scanning exceeded its configured deadline.',
  telegram_dialog_scan_stalled: 'Telegram stopped adding chats before reporting completion.',
  telegram_dialog_chat_limit: 'The Telegram chat safety limit was reached.',
  telegram_dialog_hydration_failed: 'Some Telegram dialog metadata could not be loaded.',
  telegram_dialog_chat_list_failed: 'A Telegram chat list could not be loaded completely.',
  telegram_dialog_account_unavailable: 'The Telegram account has no usable Render TDLib storage.',
  telegram_dialog_scan_failed: 'Telegram dialog scanning failed.'
}

function createGatewayError(code: string, message?: string, statusCode = 500) {
  return Object.assign(new Error(message || SAFE_ERROR_MESSAGES[code] || SAFE_ERROR_MESSAGES.telegram_gateway_operation_failed), {
    code,
    statusCode,
    gatewaySafe: true
  })
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : undefined
}

function parseBoolean(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === 'true'
}

function constantTimeTokenEquals(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  if (expectedBytes.length !== actualBytes.length) return false
  return crypto.timingSafeEqual(expectedBytes, actualBytes)
}

function bearerToken(header: unknown): string {
  const match = /^Bearer\s+(.+)$/i.exec(String(header ?? '').trim())
  return match?.[1]?.trim() || ''
}

function sanitizeGatewayValue(value: any): any {
  if (Array.isArray(value)) return value.map(sanitizeGatewayValue)
  if (!value || typeof value !== 'object') return value
  const sanitized: Record<string, any> = {}
  for (const [key, item] of Object.entries(value)) {
    if (SERVER_LOCAL_KEYS.has(key)) continue
    sanitized[key] = sanitizeGatewayValue(item)
  }
  return sanitized
}

function safeGatewayFailure(error: any): { statusCode: number; body: { error: string; message: string } } {
  const rawCode = String(error?.code || '')
  const code = SAFE_ERROR_MESSAGES[rawCode] ? rawCode : 'telegram_gateway_operation_failed'
  let statusCode = Number(error?.statusCode)
  if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
    if (code === 'telegram_account_not_found') statusCode = 404
    else if (code === 'telegram_connecting' || code === 'telegram_tdlib_database_locked') statusCode = 409
    else if (code.includes('timeout')) statusCode = 504
    else if (['telegram_readonly', 'telegram_gateway_operation_forbidden'].includes(code)) statusCode = 403
    else if (['telegram_invalid_username', 'telegram_empty_message', 'telegram_attachment_missing', 'telegram_attachment_invalid', 'telegram_gateway_invalid_request', 'telegram_gateway_invalid_operation'].includes(code)) statusCode = 400
    else statusCode = 502
  }
  return {
    statusCode,
    body: {
      error: code,
      message: SAFE_ERROR_MESSAGES[code]
    }
  }
}

function abortableRead<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(createGatewayError('telegram_gateway_cancelled', undefined, 499))
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(createGatewayError('telegram_gateway_cancelled', undefined, 499))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      value => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      error => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
    )
  })
}

function createTelegramGatewayController(options: {
  service: TelegramServiceLike
  env?: GatewayEnvironment
  logger?: (event: Record<string, unknown>) => void
}) {
  const env = options.env || process.env
  const expectedToken = String(env.WEB_CONSOLE_TDLIB_GATEWAY_TOKEN ?? '').trim()
  const configurationError = expectedToken.length < MIN_GATEWAY_TOKEN_LENGTH ? 'invalid_token' : ''

  const allowWrites = parseBoolean(env.WEB_CONSOLE_TDLIB_GATEWAY_ALLOW_WRITES)
  const allowAuthMutations = parseBoolean(env.WEB_CONSOLE_TDLIB_GATEWAY_ALLOW_AUTH_MUTATIONS)
  const allowDisconnect = parseBoolean(env.WEB_CONSOLE_TDLIB_GATEWAY_ALLOW_DISCONNECT)
  const service = options.service
  const logger = options.logger || (event => console.log(`Telegram gateway: ${JSON.stringify(event)}`))

  function authenticate(header: unknown): { ok: true } | { ok: false; statusCode: number; body: { error: string; message: string } } {
    if (configurationError) {
      return { ok: false, statusCode: 503, body: { error: 'telegram_gateway_not_configured', message: SAFE_ERROR_MESSAGES.telegram_gateway_not_configured } }
    }
    const actual = bearerToken(header)
    if (!actual || !constantTimeTokenEquals(expectedToken, actual)) {
      return { ok: false, statusCode: 401, body: { error: 'unauthorized', message: 'Unauthorized.' } }
    }
    return { ok: true }
  }

  function health() {
    return {
      ok: true,
      service: 'telegram-gateway',
      accountScope: 'all_telegram_accounts',
      capabilities: {
        reads: true,
        writes: allowWrites,
        authMutations: allowAuthMutations,
        disconnect: allowDisconnect
      }
    }
  }

  async function execute(body: any, options: { signal?: AbortSignal; requestId?: string } = {}) {
    const operation = String(body?.operation ?? '') as TelegramGatewayOperation
    if (!OPERATIONS.has(operation)) {
      throw createGatewayError('telegram_gateway_invalid_operation', undefined, 400)
    }
    if (WRITE_OPERATIONS.has(operation) && !allowWrites) {
      throw createGatewayError('telegram_gateway_operation_forbidden', undefined, 403)
    }
    if (AUTH_MUTATION_OPERATIONS.has(operation) && !allowAuthMutations) {
      throw createGatewayError('telegram_gateway_operation_forbidden', undefined, 403)
    }
    if (operation === 'disconnect' && !allowDisconnect) {
      throw createGatewayError('telegram_gateway_operation_forbidden', undefined, 403)
    }

    const requestId = String(options.requestId || crypto.randomUUID())
    const startedAt = Date.now()
    let accountRef = 'catalog'
    let outcome = 'failed'
    try {
      if (operation === 'list_admin_senders') {
        const raw = await abortableRead(service.listAdminSenders({ signal: options.signal }), options.signal)
        outcome = 'complete'
        return sanitizeGatewayValue(raw)
      }

      const clientId = positiveInteger(body?.clientId)
      const accountId = positiveInteger(body?.accountId)
      if (!clientId || !accountId) {
        throw createGatewayError('telegram_gateway_invalid_request', undefined, 400)
      }
      accountRef = `${clientId}:${accountId}`
      const input = body?.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {}
      let result: unknown
      switch (operation) {
        case 'status':
          result = await abortableRead(service.status(clientId, accountId, { signal: options.signal }), options.signal)
          break
        case 'folders':
          result = await abortableRead(service.folders(clientId, accountId, { signal: options.signal }), options.signal)
          break
        case 'dialogs':
          result = await abortableRead(service.dialogs(clientId, { ...input, accountId, signal: options.signal }), options.signal)
          break
        case 'messages':
          result = await abortableRead(service.messages(clientId, { ...input, accountId, signal: options.signal }), options.signal)
          break
        case 'scan_admin_dialogs':
          result = await service.scanAdminDialogs(clientId, { ...input, accountId, signal: options.signal })
          break
        case 'send':
          result = await service.send(clientId, { ...input, accountId, allowWrite: true })
          break
        case 'send_to_username':
          result = await service.sendToUsername(clientId, { ...input, accountId, allowWrite: true })
          break
        case 'rename_contact':
          result = await service.renameContact(clientId, { ...input, accountId })
          break
        case 'connect':
          result = await service.connect(clientId, { ...input, accountId })
          break
        case 'reauth':
          result = await service.reauth(clientId, accountId)
          break
        case 'disconnect':
          result = await service.disconnect(clientId, accountId)
          break
        default:
          throw createGatewayError('telegram_gateway_invalid_operation', undefined, 400)
      }
      outcome = 'complete'
      return sanitizeGatewayValue(result)
    } finally {
      logger({
        event: 'telegram_gateway_request',
        requestId,
        operation,
        accountRef,
        outcome,
        durationMs: Date.now() - startedAt
      })
    }
  }

  return {
    authenticate,
    execute,
    health
  }
}

function validatedRemoteConfiguration(env: GatewayEnvironment) {
  const mode = String(env.WEB_CONSOLE_TELEGRAM_MODE ?? 'local').trim().toLowerCase()
  if (mode === 'local') return { mode: 'local' as const }
  if (mode !== 'remote') {
    throw createGatewayError('telegram_gateway_not_configured', 'WEB_CONSOLE_TELEGRAM_MODE must be local or remote.', 503)
  }
  const rawUrl = String(env.WEB_CONSOLE_TDLIB_GATEWAY_URL ?? '').trim()
  const token = String(env.WEB_CONSOLE_TDLIB_GATEWAY_TOKEN ?? '').trim()
  if (!rawUrl || token.length < MIN_GATEWAY_TOKEN_LENGTH) {
    throw createGatewayError('telegram_gateway_not_configured', undefined, 503)
  }
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw createGatewayError('telegram_gateway_not_configured', undefined, 503)
  }
  const localHost = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) {
    throw createGatewayError('telegram_gateway_not_configured', 'The Telegram gateway URL must use HTTPS.', 503)
  }
  const rawTimeout = Number(env.WEB_CONSOLE_TDLIB_GATEWAY_TIMEOUT_MS ?? 180000)
  if (!Number.isFinite(rawTimeout) || rawTimeout <= 0) {
    throw createGatewayError('telegram_gateway_not_configured', undefined, 503)
  }
  return {
    mode: 'remote' as const,
    baseUrl: url.toString().replace(/\/$/, ''),
    token,
    timeoutMs: rawTimeout
  }
}

function createRemoteTelegramService(options: {
  baseUrl: string
  token: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): TelegramServiceLike {
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  const token = options.token
  const timeoutMs = options.timeoutMs || 180000
  const fetchImpl = options.fetchImpl || fetch

  async function request(operation: TelegramGatewayOperation, clientId?: number, accountId?: number, input?: Record<string, any>, callerSignal?: AbortSignal) {
    const controller = new AbortController()
    let timeoutTriggered = false
    let callerTriggered = false
    const timer = setTimeout(() => {
      timeoutTriggered = true
      controller.abort()
    }, timeoutMs)
    const onCallerAbort = () => {
      callerTriggered = true
      controller.abort()
    }
    if (callerSignal) {
      if (callerSignal.aborted) onCallerAbort()
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
    }
    try {
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}${GATEWAY_RPC_PATH}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Request-Id': crypto.randomUUID()
          },
          body: JSON.stringify({ operation, clientId, accountId, input }),
          signal: controller.signal
        })
      } catch (error) {
        if (timeoutTriggered) throw createGatewayError('telegram_gateway_timeout', undefined, 504)
        if (callerTriggered) throw createGatewayError('telegram_gateway_cancelled', undefined, 499)
        throw createGatewayError('telegram_gateway_unavailable', undefined, 502)
      }
      let payload: any
      try {
        payload = await response.json()
      } catch {
        throw createGatewayError('telegram_gateway_invalid_response', undefined, 502)
      }
      if (!response.ok) {
        const code = SAFE_ERROR_MESSAGES[String(payload?.error || '')]
          ? String(payload.error)
          : response.status === 401
            ? 'telegram_gateway_unavailable'
            : 'telegram_gateway_operation_failed'
        const statusCode = response.status === 401 && code === 'telegram_gateway_unavailable'
          ? 502
          : response.status
        throw createGatewayError(code, SAFE_ERROR_MESSAGES[code], statusCode)
      }
      if (!payload || payload.ok !== true || !Object.prototype.hasOwnProperty.call(payload, 'result')) {
        throw createGatewayError('telegram_gateway_invalid_response', undefined, 502)
      }
      return payload.result
    } finally {
      clearTimeout(timer)
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort)
    }
  }

  function requiredAccountId(value: unknown): number {
    const accountId = positiveInteger(value)
    if (!accountId) throw createGatewayError('telegram_gateway_invalid_request', undefined, 400)
    return accountId
  }

  return {
    async connect(clientId, input) {
      return await request('connect', clientId, requiredAccountId(input.accountId), input)
    },
    async status(clientId, accountId, readOptions) {
      return await request('status', clientId, requiredAccountId(accountId), undefined, readOptions?.signal)
    },
    async folders(clientId, accountId, readOptions) {
      return await request('folders', clientId, requiredAccountId(accountId), undefined, readOptions?.signal)
    },
    async dialogs(clientId, input = {}) {
      const { signal, ...payload } = input
      return await request('dialogs', clientId, requiredAccountId(input.accountId), payload, signal)
    },
    async scanAdminDialogs(clientId, input) {
      const { signal, ...payload } = input
      return await request('scan_admin_dialogs', clientId, requiredAccountId(input.accountId), payload, signal)
    },
    async messages(clientId, input) {
      const { signal, ...payload } = input
      return await request('messages', clientId, requiredAccountId(input.accountId), payload, signal)
    },
    async send(clientId, input) {
      return await request('send', clientId, requiredAccountId(input.accountId), input)
    },
    async listAdminSenders(readOptions) {
      return await request('list_admin_senders', undefined, undefined, undefined, readOptions?.signal)
    },
    async sendToUsername(clientId, input) {
      return await request('send_to_username', clientId, requiredAccountId(input.accountId), input)
    },
    async renameContact(clientId, input) {
      return await request('rename_contact', clientId, requiredAccountId(input.accountId), input)
    },
    async reauth(clientId, accountId) {
      return await request('reauth', clientId, requiredAccountId(accountId))
    },
    async disconnect(clientId, accountId) {
      return await request('disconnect', clientId, requiredAccountId(accountId))
    }
  }
}

function configuredTelegramService(localService: TelegramServiceLike, options: { env?: GatewayEnvironment; fetchImpl?: typeof fetch } = {}): TelegramServiceLike {
  const configuration = validatedRemoteConfiguration(options.env || process.env)
  if (configuration.mode === 'local') return localService
  return createRemoteTelegramService({
    baseUrl: configuration.baseUrl,
    token: configuration.token,
    timeoutMs: configuration.timeoutMs,
    fetchImpl: options.fetchImpl
  })
}

module.exports = {
  GATEWAY_HEALTH_PATH,
  GATEWAY_RPC_PATH,
  MIN_GATEWAY_TOKEN_LENGTH,
  configuredTelegramService,
  constantTimeTokenEquals,
  createGatewayError,
  createRemoteTelegramService,
  createTelegramGatewayController,
  safeGatewayFailure,
  sanitizeGatewayValue,
  validatedRemoteConfiguration
}
