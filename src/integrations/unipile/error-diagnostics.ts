const SAFE_WORDS = new Set([
  'body', 'specifics', 'linkedin', 'headline', 'bio', 'skills', 'experience', 'education',
  'operation', 'create', 'edit', 'delete', 'notify_network', 'job_title', 'company', 'school',
  'degree', 'field_of_study', 'employment_type', 'location', 'workplace_type', 'start_date',
  'end_date', 'description', 'source_of_hire', 'activities', 'grade', 'name', 'text', 'id',
  'year', 'month', 'required', 'additional', 'property', 'invalid', 'type', 'enum', 'format',
  'minimum', 'maximum', 'missing', 'must', 'have'
])

const safeToken = (value: unknown, limit = 120) => String(value ?? '')
  .toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, limit)

function safeWords(value: unknown) {
  return String(value ?? '').toLowerCase().match(/[a-z][a-z0-9_]*/g)?.filter(word =>
    SAFE_WORDS.has(word)) ?? []
}

function diagnosticWords(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return []
  if (typeof value === 'string') return safeWords(value)
  if (Array.isArray(value)) return value.flatMap(item => diagnosticWords(item, depth + 1))
  if (typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [
    ...safeWords(key), ...diagnosticWords(item, depth + 1)
  ])
}

export type SafeUnipileDiagnostics = {
  httpStatus: number
  requestId?: string
  diagnostic?: string
}

export function safeUnipileDiagnostics(status: number, data: unknown): SafeUnipileDiagnostics {
  const source = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const requestId = safeToken(source.req_id ?? source.request_id, 120)
  const words = [...new Set(diagnosticWords({
    errors: source.errors, details: source.details, detail: source.detail,
    message: source.message, validation: source.validation
  }))].slice(0, 20)
  return {
    httpStatus: Number.isInteger(status) ? status : 0,
    ...(requestId ? { requestId } : {}),
    ...(words.length ? { diagnostic: words.join('.').slice(0, 240) } : {})
  }
}
