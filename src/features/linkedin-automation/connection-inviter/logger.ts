import { AsyncLocalStorage } from 'node:async_hooks'
import type { ConnectionRun } from './types.ts'
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
  'nocoConflicts', 'nocoRetries', 'nocoRequests', 'errorName', 'causeCode', 'hasResponse',
  'responseShape', 'consecutiveEmptyCount', 'marketTier', 'term', 'emptyCursorStreak',
  'termFinishReason', 'city', 'locationId', 'locationLabel', 'unresolvedCount',
  'recruiterShortfall', 'technicalShortfall', 'nocoPhysicalAttempts',
  'nocoPhysicalRetries', 'nocoSafetyOverrun', 'snapshotAgeMs', 'snapshotFresh',
  'requestNumber', 'queueWaitMs', 'willRetry', 'executionId', 'retryAttempt', 'complete',
  'unipileRequests', 'unipilePages', 'unipileRetries', 'unipileFailures', 'cacheUses',
  'providerCache', 'providerCacheAgeSeconds', 'providerCacheHits', 'providerCacheMisses',
  'rateLimitSource', 'retryAfterMs'
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

export function safeErrorDetails(error: any) {
  return {
    errorCode: String(error?.code ?? 'connection_inviter_internal_error'),
    errorName: String(error?.name ?? 'Error'),
    causeCode: String(error?.cause?.code ?? error?.cause?.cause?.code ?? 'unknown'),
    hasResponse: Boolean(error?.response ?? error?.cause?.response),
    httpStatus: Number(error?.details?.httpStatus ?? error?.response?.status ??
      error?.cause?.response?.status) || undefined
  }
}

type Counts = { requests: number; pages: number; retries: number; failures: number;
  providerCacheHits: number; providerCacheMisses: number }
type Trace = {
  details: { runId: string; platformAccountId: number; executionId: string }
  counts: Map<string, Counts>
  reuse: Map<string, number>
  retryAttempt: number
}
const traces = new AsyncLocalStorage<Trace>()

// Capture before entering the shared scheduler; queued requests keep their own run attribution.
export const captureConnectionRequestTrace = () => traces.getStore()
export function recordConnectionRequest(trace: Trace | undefined, operation: string,
  page: boolean, adapterAttempt: number) {
  if (!trace) return undefined
  const counts = trace.counts.get(operation) ?? { requests: 0, pages: 0, retries: 0,
    failures: 0, providerCacheHits: 0, providerCacheMisses: 0 }
  trace.counts.set(operation, counts)
  counts.requests++; if (page) counts.pages++
  if (adapterAttempt > 1 || trace.retryAttempt > 1) counts.retries++
  return counts
}

export function recordPendingReuse(reason: string) {
  const trace = traces.getStore()
  if (trace) trace.reuse.set(reason, (trace.reuse.get(reason) ?? 0) + 1)
}

export function withConnectionRequestAttempt<T>(attempt: number, action: () => Promise<T>) {
  const trace = traces.getStore()
  return trace ? traces.run({ ...trace, retryAttempt: Math.max(trace.retryAttempt, attempt) }, action) : action()
}

export async function withConnectionRequestTrace<T>(run: ConnectionRun, logger: ConnectionLogger,
  action: () => Promise<T>) {
  const trace: Trace = { details: { runId: run.runId, platformAccountId: run.platformAccountId,
    executionId: randomUUID() }, counts: new Map(), reuse: new Map(), retryAttempt: 1 }
  return traces.run(trace, async () => {
    try { return await action() }
    finally {
      for (const [operation, counts] of trace.counts) {
        logger.event('unipile_request_summary', 'succeeded', { ...trace.details, operation,
          unipileRequests: counts.requests, unipilePages: counts.pages, unipileRetries: counts.retries,
          unipileFailures: counts.failures, providerCacheHits: counts.providerCacheHits,
          providerCacheMisses: counts.providerCacheMisses })
      }
      for (const [reasonCode, count] of trace.reuse) logger.event('pending_cache_summary', 'succeeded',
        { ...trace.details, reasonCode, cacheUses: count })
    }
  })
}
