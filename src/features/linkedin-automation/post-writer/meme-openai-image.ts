import { PostError, object } from './errors.ts'
import { fullRetryAfter } from './openai-client.ts'
import { MAX_MEME_BYTES } from './meme-image.ts'
import type { Log } from './types.ts'

export function createMemeImageRenderer(config: { enabled: boolean; apiKey: string; model: string },
  log: Log, request: typeof fetch = fetch) {
  return async (prompt: string, signal?: AbortSignal): Promise<Uint8Array> => {
    if (!config.enabled || !config.apiKey || config.model !== 'gpt-image-2') throw new PostError('meme_image_config_missing')
    signal?.throwIfAborted()
    const started = Date.now()
    log('meme_image_request_started', { attempt: 1 })
    const response = await request('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.any([AbortSignal.timeout(180_000), ...(signal ? [signal] : [])]),
      body: JSON.stringify({ model: config.model, prompt, n: 1, size: '1024x1280', output_format: 'png', quality: 'medium' })
    })
    const requestId = response.headers.get('x-request-id') ?? ''
    log('meme_image_response', { status: response.status, durationMs: Date.now() - started,
      requestId: /^[a-z0-9_-]{1,100}$/i.test(requestId) ? requestId : 'unavailable' })
    if (!response.ok) throw new PostError('meme_image_provider_error', fullRetryAfter(response.headers.get('retry-after')), response.status)
    const body = object(await response.json())
    const usage = body.usage ? object(body.usage) : {}
    log('meme_image_usage', { inputTokens: Number(usage.input_tokens ?? 0), outputTokens: Number(usage.output_tokens ?? 0) })
    if (!Array.isArray(body.data) || body.data.length !== 1) throw new PostError('meme_image_response_invalid')
    const data = object(body.data[0]).b64_json
    if (typeof data !== 'string' || data.length > Math.ceil(MAX_MEME_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new PostError('meme_image_response_invalid')
    return Buffer.from(data, 'base64')
  }
}
