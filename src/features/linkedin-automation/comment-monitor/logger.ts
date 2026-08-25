import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { errorLogDetails } from './errors.ts'
import type { CommentLogger } from './types.ts'

const SAFE_KEYS = new Set([
  'operationId', 'operation', 'level', 'durationMs', 'attempt', 'httpStatus', 'requestId', 'retryAfterMs',
  'page', 'count', 'candidateCount', 'inputTokens', 'outputTokens', 'cachedTokens', 'model',
  'delayMs', 'errorCode', 'reasonCode', 'checkCount', 'publishedCount', 'itemCount'
])

const token = (value: unknown, fallback = 'unknown') => {
  const safe = String(value ?? '').replace(/[^a-zA-Z0-9_.:-]+/g, '_').slice(0, 160)
  return safe || fallback
}

function safeDetails(details: Record<string, unknown>) {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_KEYS.has(key) || value === undefined) continue
    result[key] = typeof value === 'number' ? value : token(value)
  }
  return result
}

export function createCommentLogger(options: {
  jobId: string; platformAccountId: number; writeLine?: (line: string) => void; logDirectory?: string
}): CommentLogger {
  const directory = options.logDirectory ?? path.resolve(process.cwd(), 'logs/linkedin-comments')
  const file = path.join(directory, `${token(options.jobId)}-${process.pid}.jsonl`)
  const activeOperations = new Map<string, { operationId: string; startedAt: number }>()
  const write = options.writeLine ?? ((line: string) => {
    fs.mkdirSync(directory, { recursive: true }); fs.appendFileSync(file, `${line}\n`, 'utf8')
  })
  return { event(stage, status, details = {}) {
    const active = activeOperations.get(stage)
    const operationId = token(details.operationId ?? active?.operationId ?? randomUUID())
    const durationMs = typeof details.durationMs === 'number' ? details.durationMs
      : status === 'started' ? 0 : active ? Date.now() - active.startedAt : 0
    if (status === 'started') activeOperations.set(stage, { operationId, startedAt: Date.now() })
    else activeOperations.delete(stage)
    const record = { at: new Date().toISOString(), jobId: token(options.jobId),
      platformAccountId: options.platformAccountId, stage: token(stage), status,
      operationId, level: token(details.level ??
        (status === 'failed' ? 'error' : 'info')), durationMs, ...safeDetails(details) }
    try { write(JSON.stringify(record)) } catch { /* Logging must not stop monitoring. */ }
  } }
}

export async function logged<T>(logger: CommentLogger, stage: string,
  action: () => Promise<T> | T, details: Record<string, unknown> = {}) {
  const started = Date.now()
  logger.event(stage, 'started', details)
  try {
    const value = await action()
    logger.event(stage, 'succeeded', { ...details, durationMs: Date.now() - started })
    return value
  } catch (error) {
    logger.event(stage, 'failed', { ...details, durationMs: Date.now() - started,
      ...errorLogDetails(error) })
    throw error
  }
}
