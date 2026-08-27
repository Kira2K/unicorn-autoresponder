import { codedError } from '../errors.ts'
import { logAction } from '../log-action.ts'
import { NOOP_PROFILE_LOGGER, type ProfileLogger } from '../profile-logger.ts'
import { responseText } from './openai-response.ts'
import { withOpenAiRetry } from './openai-retry.ts'

function retryAfterMs(response: Response) {
  const value = response.headers.get('retry-after')?.trim()
  if (!value) return undefined
  const seconds = Number(value)
  const milliseconds = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now()
  return Number.isFinite(milliseconds) ? Math.max(0, Math.min(120_000, milliseconds)) : undefined
}
function errorDetails(response: Response, payload: any) {
  const provider = payload?.error ?? {}
  const message = String(provider.message ?? '')
  const invalidSchema = provider.code === 'invalid_json_schema'
  return {
    httpStatus: response.status,
    requestId: response.headers.get('x-request-id') ?? undefined,
    diagnostic: invalidSchema
      ? `invalid.json.schema${message.includes("'uniqueItems'") ? '.unique_items' : ''}`
      : undefined,
    fieldPath: typeof provider.param === 'string' ? provider.param : undefined,
    retryAfterMs: retryAfterMs(response)
  }
}
function httpError(response: Response, payload: any): never {
  const status = response.status
  const details = errorDetails(response, payload)
  if (status === 401 || status === 403) throw codedError('openai_credentials_rejected',
    'OpenAI credentials were rejected.', details)
  if (status === 429) throw codedError('openai_rate_limited',
    'OpenAI rate limit was reached.', details)
  if (payload?.error?.code === 'invalid_json_schema') throw codedError('openai_schema_invalid',
    'OpenAI rejected the profile output schema.', details)
  if (status >= 400 && status < 500) throw codedError('openai_request_invalid',
    'OpenAI rejected the profile generation request.', details)
  throw codedError('openai_service_unavailable',
    'OpenAI profile generation is unavailable.', details)
}

export function createOpenAiHttp(options: {
  apiKey: string; model: string; timeoutMs: number; maxOutputTokens: number
  fetchImpl?: typeof fetch; baseUrl?: string; logger?: ProfileLogger
  retrySleep?: (milliseconds: number) => Promise<void>; retryRandom?: () => number
}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const logger = options.logger ?? NOOP_PROFILE_LOGGER
  const baseUrl = options.baseUrl ?? 'https://api.openai.com/v1'
  const headers = { Authorization: `Bearer ${options.apiKey}` }
  async function requestOnce(path: string, init: RequestInit) {
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(options.timeoutMs)
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) httpError(response, payload)
      return payload
    } catch (error: any) {
      if (String(error?.code).startsWith('openai_')) throw error
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw codedError('openai_timeout', 'OpenAI profile generation timed out.')
      }
      throw codedError('openai_service_unavailable', 'OpenAI profile generation is unavailable.')
    }
  }
  const request = (path: string, init: RequestInit) => withOpenAiRetry(
    () => requestOnce(path, init), { logger, sleep: options.retrySleep, random: options.retryRandom })
  async function upload(bytes: Buffer, fileName: string, mimeType: string) {
    const form = new FormData()
    form.set('purpose', 'user_data')
    form.set('file', new Blob([Uint8Array.from(bytes)], { type: mimeType }), fileName)
    const result = await logAction(logger, 'openai_file_upload', () =>
      request('/files', { method: 'POST', body: form }))
    const id = String(result?.id ?? '')
    if (!id) throw codedError('openai_response_invalid', 'OpenAI did not accept the CV file.')
    return id
  }
  async function respond(input: unknown, schemaName: string, schema: unknown, instructions: string,
    maxOutputTokens = options.maxOutputTokens) {
    const body = { model: options.model, instructions, input, store: false, tools: [],
      max_output_tokens: maxOutputTokens,
      text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } } }
    const response = await logAction(logger, 'openai_response', () =>
      request('/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body) }), { operation: schemaName })
    const usage = response?.usage ?? {}
    logger.event('openai_usage', 'succeeded', { operation: schemaName,
      inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
      cachedTokens: usage.input_tokens_details?.cached_tokens })
    return responseText(response)
  }
  async function remove(fileId: string) {
    if (fileId) await logAction(logger, 'openai_file_delete', () =>
      request(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }))
      .catch(() => undefined)
  }
  return { remove, respond, upload }
}
