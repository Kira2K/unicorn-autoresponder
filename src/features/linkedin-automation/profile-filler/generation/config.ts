import { codedError } from '../errors.ts'

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function assertDriveCredentials(credentialsFile: string) {
  if (!credentialsFile) throw codedError('profile_cv_credentials_missing',
    'Google Drive service account credentials are missing.')
}

export function generationConfig(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = String(env.OPENAI_LINKEDIN_PROFILE_API_KEY ?? '').trim()
  const model = String(env.OPENAI_LINKEDIN_PROFILE_MODEL ?? '').trim()
  const credentialsFile = String(env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim()
  if (!apiKey) throw codedError('openai_api_key_missing', 'OpenAI API key is missing.')
  if (!model) throw codedError('openai_model_missing', 'OpenAI profile model is missing.')
  return {
    apiKey,
    model,
    credentialsFile,
    openAiTimeoutMs: positiveInt(env.OPENAI_LINKEDIN_PROFILE_TIMEOUT_MS, 120_000),
    maxOutputTokens: positiveInt(env.OPENAI_LINKEDIN_PROFILE_MAX_OUTPUT_TOKENS, 20_000),
    driveMaxBytes: positiveInt(env.LINKEDIN_PROFILE_CV_MAX_BYTES, 20 * 1024 * 1024),
    geoBaseUrl: String(env.LINKEDIN_PROFILE_GEO_BASE_URL ?? 'https://ipwho.is').replace(/\/$/, ''),
    geoTimeoutMs: positiveInt(env.LINKEDIN_PROFILE_GEO_TIMEOUT_MS, 5_000)
  }
}
