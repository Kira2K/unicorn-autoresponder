const SAFE_WORDS = new Set([
  'body', 'specifics', 'linkedin', 'headline', 'bio', 'skills', 'experience', 'education',
  'operation', 'create', 'edit', 'delete', 'notify_network', 'job_title', 'company', 'school',
  'degree', 'field_of_study', 'employment_type', 'location', 'workplace_type', 'start_date',
  'end_date', 'description', 'source_of_hire', 'activities', 'grade', 'name', 'text', 'id',
  'year', 'month', 'required', 'additional', 'property', 'invalid', 'type', 'enum', 'format',
  'minimum', 'maximum', 'missing', 'must', 'have'
])

// Correlation IDs are opaque and case-sensitive. Reject malformed values instead of rewriting them.
const safeRequestId = (value: unknown) => typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(value) ? value : undefined

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
  errorType?: string
  diagnostic?: string
  providerDetail?: string
  providerTitle?: string
  providerMessage?: string
  responseShape?: string
  requestPath?: string
  retryAfterMs?: number
}

type DiagnosticContext = { requestPath?: string; requestBody?: unknown; secrets?: string[];
  bodyFormat?: 'non_json' | 'empty' }
const ERROR_FIELDS = ['object', 'type', 'status', 'req_id', 'request_id', 'title', 'detail', 'message', 'details', 'errors', 'validation']
const VALUE_KINDS = 'absent|null|empty|string|array|object|number|boolean'

function valueKind(value: unknown): string {
  if (value === undefined) return 'absent'
  if (value === null) return 'null'
  if (typeof value === 'string' && !value.trim()) return 'empty'
  if (Array.isArray(value)) return 'array'
  return /^(string|object|number|boolean)$/.test(typeof value) ? typeof value : 'absent'
}

// Only fixed field names and value kinds, never arbitrary response keys or values.
function responseShape(data: unknown, format?: DiagnosticContext['bodyFormat']) {
  if (format) return format
  if (!data || typeof data !== 'object' || Array.isArray(data)) return valueKind(data)
  const source = data as Record<string, unknown>
  return ['object', ...ERROR_FIELDS.map(key => `${key}=${valueKind(source[key])}`),
    `other=${Math.min(999, Object.keys(source).filter(key => !ERROR_FIELDS.includes(key)).length)}`].join('; ')
}

export function safeUnipileResponseShape(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 500) return undefined
  const pattern = `^(?:non_json|${VALUE_KINDS})(?:; (?:${ERROR_FIELDS.join('|')})=(?:${VALUE_KINDS}))*?(?:; other=\\d{1,3})?$`
  return new RegExp(pattern).test(value) ? value : undefined
}
const PATH_WORDS = new Set(['v2', 'accounts', 'users', 'me', 'posts', 'comments', 'replies',
  'reactions', 'relation-requests', 'cancel', 'accept', 'relations', 'linkedin', 'search',
  'people', 'parameters', 'auth', 'intent', 'attachments'])

function requestStrings(value: unknown, depth = 0): string[] {
  if (depth > 6 || value == null) return []
  if (typeof value === 'string') return value ? [value] : []
  if (value instanceof FormData) return [...value.values()].flatMap(item =>
    typeof item === 'string' ? requestStrings(item) : [item.name])
  if (typeof value !== 'object') return []
  return Object.values(value).flatMap(item => requestStrings(item, depth + 1))
}

function requestLocation(path?: string) {
  if (!path) return { path: undefined, privateValues: [] as string[] }
  try {
    const url = new URL(path, 'https://unipile.invalid')
    const privateValues: string[] = []
    const pathname = url.pathname.split('/').map(part => {
      if (!part || PATH_WORDS.has(part) || part === ':id') return part
      privateValues.push(part, decodeURIComponent(part)); return ':id'
    }).join('/')
    const query = new URLSearchParams()
    for (const [key, value] of url.searchParams) {
      if (['limit', 'offset'].includes(key) && /^\d{1,6}$/.test(value)) query.set(key, value)
      else if (key === 'type' && ['sent', 'received'].includes(value)) query.set(key, value)
      else if (key === 'variant' && ['linkedin_classic', 'linkedin_recruiter', 'linkedin_sales_navigator'].includes(value)) query.set(key, value)
      else {
        if (value) privateValues.push(value)
        if (key === 'cursor') query.set(key, 'present')
      }
    }
    return { path: pathname + (query.size ? `?${query}` : ''), privateValues }
  } catch { return { path: undefined, privateValues: [] as string[] } }
}

// Keep the provider's explanation, not arbitrary response objects or reflected request data.
function providerDetail(value: unknown, privateValues: string[]) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  let text = value
  const variants = privateValues.filter(Boolean).flatMap(item => [item, JSON.stringify(item).slice(1, -1)])
  for (const secret of [...new Set(variants)].sort((a, b) => b.length - a.length))
    text = text.split(secret).join('[redacted]')
  text = text
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=][^\r\n]*/gi, '[redacted]')
    .replace(/\b(?:bearer|basic)\s+[^\s,;]+/gi, '[redacted]')
    .replace(/\b(?:password|passwd|api[-_]?key|x-api-key|token|secret|li_at|session|cursor)["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '[redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/[A-Za-z0-9_+/=-]{40,}/g, '[redacted]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  return text.length > 4096 ? text.slice(0, 4096) + ' [truncated]' : text
}

export function safeUnipileDiagnostics(status: number, data: unknown, context: DiagnosticContext = {}): SafeUnipileDiagnostics {
  const source = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const location = requestLocation(context.requestPath)
  const privateValues = [...(context.secrets ?? []), ...requestStrings(context.requestBody), ...location.privateValues]
  const detail = providerDetail(source.detail, privateValues)
  const title = providerDetail(source.title, privateValues)
  const message = providerDetail(source.message, privateValues)
  const requestId = safeRequestId(source.req_id ?? source.request_id)
  const errorType = typeof source.type === 'string' && source.type.length <= 120 &&
    /^[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*)?$/.test(source.type) ? source.type : undefined
  const words = [...new Set(diagnosticWords({
    errors: source.errors, details: source.details, detail: source.detail,
    message: source.message, validation: source.validation
  }))].slice(0, 20)
  return {
    httpStatus: Number.isInteger(status) ? status : 0,
    ...(requestId ? { requestId } : {}),
    ...(errorType ? { errorType } : {}),
    ...(detail ? { providerDetail: detail } : {}),
    ...(title ? { providerTitle: title } : {}),
    ...(message ? { providerMessage: message } : {}),
    responseShape: responseShape(data, context.bodyFormat),
    ...(location.path ? { requestPath: location.path } : {}),
    ...(words.length ? { diagnostic: words.join('.').slice(0, 240) } : {})
  }
}
