import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

export type ConnectionLogger = { event(stage: string, status: 'started' | 'succeeded' | 'failed',
  details?: Record<string, unknown>): void }
export const NOOP_CONNECTION_LOGGER: ConnectionLogger = { event() {} }

const SAFE_KEYS = new Set([
  'operationId', 'operation', 'level', 'durationMs', 'attempt', 'httpStatus', 'page', 'count',
  'candidateCount', 'eligibleCount', 'skippedCount', 'pendingCount', 'activeCount', 'acceptedCount',
  'connectionCount', 'dailyLimit', 'dailyQuota', 'recruiterQuota', 'technicalQuota', 'searchKey',
  'sentToday', 'recruiterRemaining', 'technicalRemaining',
  'audience', 'reasonCode', 'errorCode', 'runId', 'platformAccountId', 'runStatus', 'runStage',
  'itemStatus', 'delayMs', 'sentCount', 'safeRecruiterOnly', 'created', 'cursorPresent',
  'provider', 'nextRetryAt', 'firstFailedAt', 'lastFailedAt', 'keyIndex', 'keyTotal',
  'candidateHash', 'roleCategory', 'locationMatch', 'stackEvidence', 'hardReasonCodes',
  'softSignalCodes', 'nocoReads', 'nocoPages', 'nocoCreates', 'nocoPatches',
  'nocoConflicts', 'nocoRetries', 'nocoRequests'
])

const token = (value: unknown, fallback = 'unknown') => {
  const result = String(value ?? '').replace(/[^a-zA-Z0-9_.:-]+/g, '_').slice(0, 160)
  return result || fallback
}

function safeDetails(details: Record<string, unknown>) {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_KEYS.has(key) || value === undefined) continue
    result[key] = typeof value === 'number' || typeof value === 'boolean' ? value : token(value)
  }
  return result
}

export function createConnectionLogger(options: {
  writeLine?: (line: string) => void; logDirectory?: string
} = {}): ConnectionLogger {
  const directory = options.logDirectory ?? path.resolve(process.cwd(), 'logs/linkedin-connections')
  const file = path.join(directory, `connection-inviter-${process.pid}.jsonl`)
  const active = new Map<string, { operationId: string; startedAt: number }>()
  const write = options.writeLine ?? ((line: string) => {
    fs.mkdirSync(directory, { recursive: true }); fs.appendFileSync(file, `${line}\n`, 'utf8')
    console.log(`Connection Inviter: ${line}`)
  })
  return { event(stage, status, details = {}) {
    const safe = safeDetails(details)
    const subject = safe.runId ?? safe.platformAccountId ?? safe.operation ?? 'service'
    const key = `${stage}:${subject}`
    const current = active.get(key); const operationId = token(safe.operationId ??
      current?.operationId ?? randomUUID())
    const durationMs = typeof safe.durationMs === 'number' ? safe.durationMs
      : status === 'started' ? 0 : current ? Date.now() - current.startedAt : 0
    if (status === 'started') active.set(key, { operationId, startedAt: Date.now() })
    else active.delete(key)
    const record = { at: new Date().toISOString(), feature: 'linkedin_connection_inviter',
      stage: token(stage), status, operationId, durationMs,
      level: token(safe.level ?? (status === 'failed' ? 'error' : 'info')), ...safe }
    try { write(JSON.stringify(record)) } catch { /* Logging must never stop invitations. */ }
  } }
}

export async function logged<T>(logger: ConnectionLogger, stage: string,
  details: Record<string, unknown>, action: () => Promise<T>): Promise<T> {
  logger.event(stage, 'started', details)
  try { const result = await action(); logger.event(stage, 'succeeded', details); return result }
  catch (error: any) { logger.event(stage, 'failed', { ...details,
    errorCode: String(error?.code ?? 'connection_inviter_internal_error') }); throw error }
}
