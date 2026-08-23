const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { getAuthErrorCode, safeErrorCode } = require('./errors.ts') as {
  getAuthErrorCode(error: unknown): string
  safeErrorCode(value: unknown, fallback?: string): string
}

type AuthLogStatus = import('./auth-log-types.ts').AuthLogStatus
type AuthLogDetails = import('./auth-log-types.ts').AuthLogDetails
type AuthLogRecord = import('./auth-log-types.ts').AuthLogRecord
type AuthLogger = import('./auth-log-types.ts').AuthLogger

const NOOP_AUTH_LOGGER: AuthLogger = {
  event() {},
  async run<T>(_stage: string, _details: AuthLogDetails, action: () => Promise<T>) {
    return await action()
  }
}

function cleanDetails(details: AuthLogDetails): AuthLogDetails {
  const clean: AuthLogDetails = {}
  const numberKeys = ['clientId', 'platformAccountId', 'dolphinProfileId', 'durationMs'] as const
  const booleanKeys = [
    'existingAccount', 'authenticated', 'cookiePresent', 'userAgentPresent', 'ownerMatched'
  ] as const
  for (const key of numberKeys) if (Number.isFinite(details[key])) clean[key] = details[key]
  for (const key of booleanKeys) if (typeof details[key] === 'boolean') clean[key] = details[key]
  if (['dry-run', 'apply', 'force-reauth'].includes(String(details.mode))) clean.mode = details.mode
  const protocols = ['http', 'https', 'socks4', 'socks5']
  if (protocols.includes(String(details.dolphinProtocol))) clean.dolphinProtocol = details.dolphinProtocol
  if (protocols.includes(String(details.unipileProtocol))) clean.unipileProtocol = details.unipileProtocol
  if (details.errorCode) clean.errorCode = safeErrorCode(details.errorCode)
  return clean
}

function createLinkedInAuthLogger(options: {
  runId?: string
  logDirectory?: string
  writeLine?: (line: string) => void
  writeProgress?: (line: string) => void
  onEvent?: (record: AuthLogRecord) => void
} = {}): AuthLogger {
  const runId = options.runId ?? `linkedin-auth-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const directory = options.logDirectory ?? path.resolve(__dirname, '../../../../logs/linkedin-auth')
  const file = path.join(directory, `${runId}-${process.pid}.jsonl`)
  const writeLine = options.writeLine ?? ((line: string) => {
    fs.mkdirSync(directory, { recursive: true })
    fs.appendFileSync(file, `${line}\n`, 'utf8')
  })
  const writeProgress = options.writeProgress ?? ((line: string) => console.error(line))
  const progress = (line: string) => { try { writeProgress(line) } catch {} }

  function event(stage: string, status: AuthLogStatus, details: AuthLogDetails = {}) {
    const record: AuthLogRecord = {
      at: new Date().toISOString(), runId, stage: safeErrorCode(stage, 'unknown'), status,
      ...cleanDetails(details)
    }
    try { writeLine(JSON.stringify(record)) } catch { progress('[LinkedIn auth] log_write_failed') }
    try { options.onEvent?.(record) } catch {}
    if (status !== 'started' || stage === 'run_started') {
      progress(`[LinkedIn auth] ${record.stage}: ${status}`)
    }
  }

  async function run<T>(stage: string, details: AuthLogDetails, action: () => Promise<T>) {
    const started = Date.now()
    event(stage, 'started', details)
    try {
      const result = await action()
      event(stage, 'succeeded', { ...details, durationMs: Date.now() - started })
      return result
    } catch (error: unknown) {
      event(stage, 'failed', {
        ...details, durationMs: Date.now() - started, errorCode: getAuthErrorCode(error)
      })
      throw error
    }
  }

  return { event, run }
}

module.exports = { NOOP_AUTH_LOGGER, createLinkedInAuthLogger }
export type { AuthLogDetails, AuthLogger, AuthLogRecord } from './auth-log-types.ts'
