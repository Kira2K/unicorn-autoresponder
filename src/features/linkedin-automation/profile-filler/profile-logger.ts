import * as fs from 'node:fs'
import * as path from 'node:path'

export type ProfileLogDetails = {
  stepId?: string
  section?: string
  attempt?: number
  maxAttempts?: number
  observation?: 'matched' | 'unchanged' | 'mismatch' | 'unavailable'
  errorCode?: string
  durationMs?: number
  httpStatus?: number
  requestId?: string
  diagnostic?: string
  operation?: string
  stepCount?: number
  issueCount?: number
  fatalCount?: number
  payloadFields?: string[]
  fieldPath?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
}

export type ProfileLogger = {
  event(stage: string, status: 'started' | 'succeeded' | 'failed', details?: ProfileLogDetails): void
}

export const NOOP_PROFILE_LOGGER: ProfileLogger = { event() {} }

const SAFE_DIAGNOSTIC_WORDS = new Set([
  'body', 'specifics', 'linkedin', 'headline', 'bio', 'skills', 'experience', 'education',
  'operation', 'create', 'edit', 'delete', 'notify_network', 'job_title', 'company', 'school',
  'degree', 'field_of_study', 'employment_type', 'location', 'workplace_type', 'start_date',
  'end_date', 'description', 'source_of_hire', 'activities', 'grade', 'name', 'text', 'id',
  'year', 'month', 'required', 'additional', 'property', 'invalid', 'type', 'enum', 'format',
  'minimum', 'maximum', 'missing', 'must', 'have', 'json', 'schema', 'unique_items'
])

const safeToken = (value: unknown, fallback: string) => {
  const clean = String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 120)
  return clean || fallback
}

function cleanDetails(details: ProfileLogDetails) {
  const clean: ProfileLogDetails = {}
  for (const key of ['stepId', 'section', 'requestId', 'operation'] as const) {
    if (details[key]) clean[key] = safeToken(details[key], 'unknown')
  }
  for (const key of ['attempt', 'maxAttempts', 'durationMs', 'httpStatus', 'stepCount',
    'issueCount', 'fatalCount', 'inputTokens', 'outputTokens', 'cachedTokens'] as const) {
    if (Number.isFinite(details[key])) clean[key] = details[key]
  }
  if (['matched', 'unchanged', 'mismatch', 'unavailable'].includes(String(details.observation))) {
    clean.observation = details.observation
  }
  if (details.errorCode) clean.errorCode = safeToken(details.errorCode, 'internal_error')
  const diagnostic = String(details.diagnostic ?? '').split('.').filter(Boolean)
  if (diagnostic.length && diagnostic.every(word => SAFE_DIAGNOSTIC_WORDS.has(word))) {
    clean.diagnostic = diagnostic.join('_').slice(0, 240)
  }
  if (Array.isArray(details.payloadFields)) {
    clean.payloadFields = details.payloadFields.slice(0, 30).map(value => safeToken(value, 'unknown'))
  }
  if (details.fieldPath) {
    clean.fieldPath = String(details.fieldPath).replace(/[^a-zA-Z0-9_.[\]-]+/g, '_').slice(0, 180)
  }
  return clean
}

export function createProfileLogger(options: {
  jobId: string
  logDirectory?: string
  writeLine?: (line: string) => void
}): ProfileLogger {
  const jobId = safeToken(options.jobId, 'unknown-job')
  const directory = options.logDirectory ?? path.resolve(process.cwd(), 'logs/linkedin-profile')
  const file = path.join(directory, `${jobId}-${process.pid}.jsonl`)
  const writeLine = options.writeLine ?? ((line: string) => {
    fs.mkdirSync(directory, { recursive: true })
    fs.appendFileSync(file, `${line}\n`, 'utf8')
  })
  return {
    event(stage, status, details = {}) {
      const record = { at: new Date().toISOString(), jobId,
        stage: safeToken(stage, 'unknown'), status, ...cleanDetails(details) }
      try { writeLine(JSON.stringify(record)) } catch { /* Logging must not stop a profile update. */ }
    }
  }
}
