import type { FeedModel } from './selection.mts'

/** Credentials/model are supplied by the composition root. No ENV or storage access. */
export function createFeedModel(options: { apiKey: string; model: string; signal?: AbortSignal; fetchImpl?: typeof fetch }): FeedModel {
  if (!options.apiKey || !options.model) throw Object.assign(new Error('feed_model_not_configured'), { code: 'feed_model_not_configured' })
  const generate = async (input: { instructions: string; [key: string]: unknown }, schema: unknown) => {
    const { instructions, ...data } = input
    const response = await (options.fetchImpl ?? fetch)('https://api.openai.com/v1/responses', {
      method: 'POST', signal: AbortSignal.any([AbortSignal.timeout(90_000), ...(options.signal ? [options.signal] : [])]),
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: options.model, instructions,
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(data) }] }],
        store: false, tools: [], max_output_tokens: 5000,
        text: { format: { type: 'json_schema', name: 'linkedin_feed', strict: true, schema } } })
    })
    if (!response.ok) throw Object.assign(new Error('openai_feed_failed'), { code: 'openai_feed_failed', details: { httpStatus: response.status } })
    const body = await response.json()
    const content = (body?.output ?? []).flatMap((item: any) => item?.content ?? [])
    if (body?.status === 'incomplete' || content.some((c: any) => c.type === 'refusal')) throw new Error('feed_model_incomplete')
    try { return JSON.parse(content.filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('')) }
    catch { throw new Error('feed_model_response_invalid') }
  }
  return {
    evaluate: input => generate(input, { type: 'object', additionalProperties: false, required: ['assessments'], properties: {
      assessments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'category', 'reason'], properties: {
        id: { type: 'string' }, category: { type: 'string', enum: ['professional', 'advertisement', 'spam', 'other', 'uncertain'] }, reason: { type: 'string' }
      } } }
    } }),
    comment: input => generate(input, { type: 'object', additionalProperties: false, required: ['text', 'evidence'],
      properties: { text: { type: 'string' }, evidence: { type: 'string' } } })
  }
}
