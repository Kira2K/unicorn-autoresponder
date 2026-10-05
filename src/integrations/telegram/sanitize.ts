import type { SerializableError } from './types.ts'

const REDACTED = '[REDACTED]'
const CIRCULAR = '[Circular]'
const TRUNCATED = '[Truncated]'
const SENSITIVE_KEY = /(token|authorization|cookie|password|secret|credential)/i

export type SanitizeOptions = {
  maxDepth?: number
  maxStringLength?: number
  maxArrayLength?: number
  maxObjectKeys?: number
  secrets?: readonly string[]
}

const DEFAULTS = {
  maxDepth: 5,
  maxStringLength: 512,
  maxArrayLength: 25,
  maxObjectKeys: 50
} as const

function redactString(value: string, secrets: readonly string[]): string {
  let safe = value.replace(/\/bot[^/\s]+\//gi, '/bot[REDACTED]/')
  for (const secret of secrets) {
    if (!secret) continue
    safe = safe.split(secret).join(REDACTED)
  }
  return safe
}

export function sanitizeTelegramValue(
  value: unknown,
  options: SanitizeOptions = {}
): unknown {
  try {
    const limits = {
      maxDepth: options.maxDepth ?? DEFAULTS.maxDepth,
      maxStringLength: options.maxStringLength ?? DEFAULTS.maxStringLength,
      maxArrayLength: options.maxArrayLength ?? DEFAULTS.maxArrayLength,
      maxObjectKeys: options.maxObjectKeys ?? DEFAULTS.maxObjectKeys
    }
    const secrets = (options.secrets ?? []).filter(Boolean)
    const seen = new WeakSet<object>()

    function visit(current: unknown, depth: number): unknown {
      if (current === null || typeof current === 'boolean' || typeof current === 'number') {
        return Number.isFinite(current as number) || typeof current !== 'number'
          ? current
          : String(current)
      }
      if (typeof current === 'string') {
        const redacted = redactString(current, secrets)
        return redacted.length <= limits.maxStringLength
          ? redacted
          : `${redacted.slice(0, limits.maxStringLength)}${TRUNCATED}`
      }
      if (typeof current === 'bigint' || typeof current === 'symbol' || typeof current === 'function') {
        return String(current)
      }
      if (current === undefined) return '[Undefined]'
      if (typeof current !== 'object') return String(current)
      if (seen.has(current)) return CIRCULAR
      if (depth >= limits.maxDepth) return TRUNCATED
      seen.add(current)

      if (Array.isArray(current)) {
        const result = current
          .slice(0, limits.maxArrayLength)
          .map(item => visit(item, depth + 1))
        if (current.length > limits.maxArrayLength) result.push(TRUNCATED)
        return result
      }

      const result: Record<string, unknown> = {}
      const source = current as Record<string, unknown>
      let keys: string[]
      try {
        keys = Object.getOwnPropertyNames(source)
      } catch {
        return '[Uninspectable Object]'
      }
      if (current instanceof Error) {
        for (const key of ['name', 'message', 'stack', 'cause']) {
          if (!keys.includes(key)) keys.unshift(key)
        }
      }
      for (const key of keys.slice(0, limits.maxObjectKeys)) {
        if (SENSITIVE_KEY.test(key)) {
          result[key] = REDACTED
          continue
        }
        try {
          result[key] = visit(source[key], depth + 1)
        } catch {
          result[key] = '[Unreadable]'
        }
      }
      if (keys.length > limits.maxObjectKeys) result.__truncated__ = TRUNCATED
      return result
    }

    return visit(value, 0)
  } catch {
    return '[Sanitization Failed]'
  }
}

function property(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  try {
    return (value as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

export function serializeTelegramError(
  error: unknown,
  options: SanitizeOptions = {}
): SerializableError {
  try {
    const rawName = property(error, 'name')
    const rawMessage = property(error, 'message')
    const rawCode = property(error, 'code')
    const rawStatus = property(error, 'status') ?? property(property(error, 'details'), 'status')
    const safeMessage = sanitizeTelegramValue(
      typeof rawMessage === 'string' ? rawMessage : String(error),
      options
    )
    const safeDetails = sanitizeTelegramValue(
      property(error, 'details') ?? property(error, 'cause'),
      options
    )
    return {
      name: typeof rawName === 'string' && rawName ? rawName : 'Error',
      message: typeof safeMessage === 'string' ? safeMessage : 'Unknown Telegram integration error.',
      ...(typeof rawCode === 'string' && rawCode ? { code: rawCode } : {}),
      ...(typeof rawStatus === 'number' && Number.isFinite(rawStatus)
        ? { status: rawStatus }
        : {}),
      ...(safeDetails && typeof safeDetails === 'object' && !Array.isArray(safeDetails)
        ? { details: safeDetails as Record<string, unknown> }
        : {})
    }
  } catch {
    return {
      name: 'Error',
      message: 'Unknown Telegram integration error.'
    }
  }
}
