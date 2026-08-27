import { COMMENT_INSTRUCTIONS, COMMENT_REPLY_SCHEMA } from './openai-schema.ts'
import { commentError } from './errors.ts'
import type { CommentLogger } from './types.ts'

function config(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = String(env.OPENAI_LINKEDIN_COMMENT_API_KEY ??
    env.OPENAI_LINKEDIN_PROFILE_API_KEY ?? '').trim()
  const model = String(env.OPENAI_LINKEDIN_COMMENT_MODEL ??
    env.OPENAI_LINKEDIN_PROFILE_MODEL ?? '').trim()
  if (!apiKey) throw commentError('openai_api_key_missing', 'OpenAI comment API key is missing.')
  if (!model) throw commentError('openai_model_missing', 'OpenAI comment model is missing.')
  return { apiKey, model, timeoutMs: Number(env.OPENAI_LINKEDIN_COMMENT_TIMEOUT_MS) || 60_000 }
}

function outputText(response: any) {
  if (response?.status === 'incomplete') throw commentError('openai_response_incomplete',
    'OpenAI response was incomplete.')
  const content = (response?.output ?? []).flatMap((item: any) => item?.content ?? [])
  if (content.some((item: any) => item?.type === 'refusal')) {
    throw commentError('openai_response_refused', 'OpenAI refused comment generation.')
  }
  const text = content.filter((item: any) => item?.type === 'output_text')
    .map((item: any) => item.text).join('')
  try { return JSON.parse(text) } catch {
    throw commentError('openai_response_invalid', 'OpenAI returned invalid structured output.')
  }
}

export function createCommentOpenAi(options: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {}) {
  const settings = config(options.env)
  const fetchImpl = options.fetchImpl ?? fetch
  return { model: settings.model, async generate(input: unknown, logger: CommentLogger) {
    const started = Date.now()
    logger.event('openai_response', 'started', { model: settings.model })
    try {
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', signal: AbortSignal.timeout(settings.timeoutMs),
        headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: settings.model, instructions: COMMENT_INSTRUCTIONS,
          input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
          store: false, tools: [], max_output_tokens: 1000,
          text: { format: { type: 'json_schema', name: 'linkedin_comment_replies', strict: true,
            schema: COMMENT_REPLY_SCHEMA } } })
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw commentError(response.status === 429 ? 'openai_rate_limited' :
        'openai_request_failed', 'OpenAI comment generation failed.', { httpStatus: response.status,
          requestId: response.headers.get('x-request-id') })
      const usage = body?.usage ?? {}
      logger.event('openai_response', 'succeeded', { model: settings.model,
        durationMs: Date.now() - started, inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens, cachedTokens: usage.input_tokens_details?.cached_tokens })
      return outputText(body)
    } catch (error: any) {
      const failure = String(error?.code).startsWith('openai_') ? error :
        commentError('openai_service_unavailable', 'OpenAI comment generation is unavailable.')
      logger.event('openai_response', 'failed', { model: settings.model,
        durationMs: Date.now() - started, errorCode: failure.code })
      throw failure
    }
  } }
}
