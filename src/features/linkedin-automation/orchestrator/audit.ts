import type { AuditEvent, AutomationStore, Feature } from './contracts.ts'
import { automationError } from './contracts.ts'

// Never accept provider bodies or arbitrary error messages into the durable journal.
const numericFields = new Set(['attempt','status','httpStatus','retryAfterMs','durationMs','count','total','completed','remaining','nextActionAt',
  'delayMs','publishedCount','checkCount','sentCount','eligibleCount','skippedCount','page','queueWaitMs','inputTokens','outputTokens','itemCount','likesConfirmed'])
const codeFields = new Set(['code','state','status','stage','reason','provider','operation','result','errorCode','reasonCode','causeCode'])
export function safeDetails(input: Record<string, unknown> = {}): NonNullable<AuditEvent['details']> {
  const result: NonNullable<AuditEvent['details']> = {}
  for (const [key,value] of Object.entries(input)) {
    if (numericFields.has(key) && typeof value === 'number' && Number.isFinite(value)) result[key] = value
    else if (codeFields.has(key) && typeof value === 'string' && /^[a-z][a-z0-9_.:-]{0,99}$/.test(value)) result[key] = value
  }
  return result
}
export const safeCode = (value: unknown, fallback = 'automation_feature_unavailable') =>
  typeof value === 'string' && /^[a-z][a-z0-9_]{0,99}$/.test(value) ? value : fallback

export function createAutomationAudit(store: AutomationStore, now = Date.now) {
  let pending = Promise.resolve(), failure: unknown
  async function record(event: Omit<AuditEvent,'at'>) { await store.appendEvent({ ...event, at: now(),
    stage: safeCode(event.stage), code: safeCode(event.code), details: safeDetails(event.details) }) }
  return {
    record,
    // Existing synchronous loggers are drained before every external write. A storage failure closes the write gate.
    logger(feature: Feature) { return (event: string, fields: Record<string,unknown> = {}) => {
      const accountValue = Number(fields.platformAccountId ?? fields.account)
      const account = Number.isSafeInteger(accountValue) && accountValue > 0 ? accountValue : undefined
      pending = pending.then(async () => {
        const runs = await store.runs(account)
        const run = runs.find(r => r.feature === feature && ((fields.automationKey && r.key === fields.automationKey) || (fields.runId && r.featureRunId === fields.runId) ||
          (account !== undefined && ['starting','running','monitoring'].includes(r.state))))
        if (!run) {
          if(fields.code || fields.errorCode || fields.status==='failed')await record({feature,account,
            stage:safeCode(event),code:safeCode(fields.code??fields.errorCode),level:'error',details:safeDetails(fields)})
          return
        }
        const code=fields.code ?? fields.errorCode ?? fields.reasonCode
        await record({account:run.account,feature,runKey:run.key,stage:safeCode(event),code:safeCode(code,event),
          level:fields.code || fields.errorCode || fields.status==='failed' ? 'error' : fields.level==='warn'?'warning':'info',details:safeDetails(fields)})
      }).catch(error => { failure = error })
    } },
    async flush() { await pending; if (failure) throw automationError('automation_audit_unavailable') }
  }
}
