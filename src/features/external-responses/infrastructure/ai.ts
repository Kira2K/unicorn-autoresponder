import { createOpenAiHttp } from '../../linkedin-automation/profile-filler/generation/openai-http.ts'
import type { AiUsageRecorder } from './ai-usage.ts'
export type Client = ReturnType<typeof createOpenAiHttp>
export const string = { type: 'string' }, strings = { type: 'array', items: string }
export const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
export function createAiClient(env = process.env, options: { usage?: AiUsageRecorder; fetchImpl?: typeof fetch; retrySleep?: (ms: number) => Promise<void>; retryRandom?: () => number; maxOutputTokens?:number } = {}): Client {
  const apiKey = env.OPENAI_EXTERNAL_RESPONSES_API_KEY ?? env.OPENAI_HH_PROFILE_API_KEY ?? env.OPENAI_LINKEDIN_PROFILE_API_KEY ?? env.OPENAI_API_KEY
  const model = env.OPENAI_EXTERNAL_RESPONSES_MODEL ?? env.OPENAI_HH_PROFILE_MODEL ?? env.OPENAI_LINKEDIN_PROFILE_MODEL
  if (!apiKey || !model) throw Error('Configure OPENAI_EXTERNAL_RESPONSES_API_KEY and OPENAI_EXTERNAL_RESPONSES_MODEL (existing profile AI settings are also supported)')
  const transport = (operation: string, kind: 'inference' | 'file') => createOpenAiHttp({ apiKey, model, timeoutMs: 120_000, maxOutputTokens: options.maxOutputTokens ?? 8000,
    fetchImpl: options.usage ? options.usage.track(options.fetchImpl ?? fetch, operation, model, kind) : options.fetchImpl,
    retrySleep: options.retrySleep, retryRandom: options.retryRandom })
  return {
    respond: (...args: Parameters<Client['respond']>) => transport(args[1], 'inference').respond(...args),
    upload: (...args: Parameters<Client['upload']>) => transport('cv_upload', 'file').upload(...args),
    remove: (...args: Parameters<Client['remove']>) => transport('cv_remove', 'file').remove(...args)
  }
}

export { existingCvExtractor } from '../candidate_intake/cv-extractor.ts'
export { aiFitAssessor } from '../candidate_matching/ai-fit.ts'
export { createAnswerGenerator } from '../application_preparation/answers.ts'
