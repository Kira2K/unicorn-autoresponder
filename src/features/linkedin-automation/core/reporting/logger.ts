const { redactObject, redactText } = require('../safety/redaction.ts') as typeof import('../safety/redaction.ts')

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogContext = {
  correlationId?: string
  accountId?: string
  jobId?: string
  planId?: string
  stepId?: string
}

export type LogEntry = LogContext & {
  timestamp: string
  level: LogLevel
  event: string
  message: string
  details?: unknown
}

export type Logger = {
  debug(event: string, message: string, details?: unknown): void
  info(event: string, message: string, details?: unknown): void
  warn(event: string, message: string, details?: unknown): void
  error(event: string, message: string, details?: unknown): void
  child(context: LogContext): Logger
}

type LoggerOptions = {
  context?: LogContext
  sink?: (entry: LogEntry) => void
  clock?: () => Date
  minimumLevel?: LogLevel
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function consoleSink(entry: LogEntry): void {
  const writer = entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : console.log
  writer(JSON.stringify(entry))
}

function makeLogger(
  context: LogContext,
  sink: (entry: LogEntry) => void,
  clock: () => Date,
  minimumLevel: LogLevel,
): Logger {
  function write(level: LogLevel, event: string, message: string, details?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) return
    const safeContext = redactObject(context) as LogContext
    const entry: LogEntry = {
      timestamp: clock().toISOString(),
      level,
      event: redactText(event),
      message: redactText(message),
      ...safeContext,
      ...(details === undefined ? {} : { details: redactObject(details) }),
    }
    sink(entry)
  }

  return {
    debug: (event, message, details) => write('debug', event, message, details),
    info: (event, message, details) => write('info', event, message, details),
    warn: (event, message, details) => write('warn', event, message, details),
    error: (event, message, details) => write('error', event, message, details),
    child: extra => makeLogger({ ...context, ...extra }, sink, clock, minimumLevel),
  }
}

function createStructuredLogger(options: LoggerOptions = {}): Logger {
  return makeLogger(
    options.context ?? {},
    options.sink ?? consoleSink,
    options.clock ?? (() => new Date()),
    options.minimumLevel ?? 'info',
  )
}

function createMemoryLogger(options: Omit<LoggerOptions, 'sink'> = {}): {
  logger: Logger
  entries: LogEntry[]
} {
  const entries: LogEntry[] = []
  return {
    entries,
    logger: createStructuredLogger({ ...options, sink: entry => entries.push(entry) }),
  }
}

function toSafeErrorMetadata(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { name: 'UnknownError', message: redactText(String(error)) }
  }
  const candidate = error as Error & {
    code?: unknown
    status?: unknown
    retryAfter?: unknown
  }
  return redactObject({
    name: error.name,
    message: error.message,
    ...(candidate.code === undefined ? {} : { code: candidate.code }),
    ...(candidate.status === undefined ? {} : { status: candidate.status }),
    ...(candidate.retryAfter === undefined ? {} : { retryAfter: candidate.retryAfter }),
  }) as Record<string, unknown>
}

const NOOP_LOGGER: Logger = makeLogger({}, () => undefined, () => new Date(0), 'error')

module.exports = {
  createMemoryLogger,
  createStructuredLogger,
  NOOP_LOGGER,
  toSafeErrorMetadata,
}
