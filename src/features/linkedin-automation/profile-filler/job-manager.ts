const { randomUUID } = require('node:crypto')
const { NOOP_LOGGER, toSafeErrorMetadata } = require('../core/reporting/logger.ts') as typeof import('../core/reporting/logger.ts')

type AutomationJobStatus = import('../core/jobs/job-types.ts').AutomationJobStatus
type AutomationJobType = import('../core/jobs/job-types.ts').AutomationJobType
type Logger = import('../core/reporting/logger.ts').Logger

export type JobContext = {
  jobId: string
  accountId: string
  shouldCancel(): boolean
}

export type JobSnapshot = {
  id: string
  type: AutomationJobType
  kind: string
  accountId: string
  status: AutomationJobStatus
  createdAt: string
  startedAt?: string
  finishedAt?: string
  cancelRequested: boolean
  error?: Record<string, unknown>
}

export type JobHandle<T> = {
  jobId: string
  result: Promise<T>
}

type JobRecord<T = unknown> = JobSnapshot & {
  result: Promise<T>
}

type EnqueueInput<T> = {
  type: AutomationJobType
  kind: string
  accountId: string
  run(context: JobContext): Promise<T>
}

type JobManagerOptions = {
  logger?: Logger
  clock?: () => Date
}

class JobCancelledError extends Error {
  code = 'job_cancelled'

  constructor(message = 'Job отменён.') {
    super(message)
    this.name = 'JobCancelledError'
  }
}

class AccountJobManager {
  private readonly jobs = new Map<string, JobRecord>()
  private readonly accountTails = new Map<string, Promise<void>>()
  private readonly logger: Logger
  private readonly clock: () => Date

  constructor(options: JobManagerOptions = {}) {
    this.logger = options.logger ?? NOOP_LOGGER
    this.clock = options.clock ?? (() => new Date())
  }

  enqueue<T>(input: EnqueueInput<T>): JobHandle<T> {
    const type = input.type
    const kind = input.kind
    const accountId = input.accountId
    const run = input.run
    const jobId = randomUUID()
    const previous = this.accountTails.get(accountId) ?? Promise.resolve()
    const record: JobRecord<T> = {
      id: jobId,
      type,
      kind,
      accountId,
      status: 'waiting',
      createdAt: this.clock().toISOString(),
      cancelRequested: false,
      result: Promise.resolve(undefined as T),
    }
    const logger = this.logger.child({ jobId, accountId })
    logger.info('job.queued', 'Job поставлен в очередь аккаунта.', {
      type,
      kind,
    })

    const execute = async (): Promise<T> => {
      try {
        if (record.cancelRequested) throw new JobCancelledError('Job отменён до запуска.')
        record.status = 'running'
        record.startedAt = this.clock().toISOString()
        logger.info('job.started', 'Job начал выполнение.', { type, kind })
        const result = await run({
          jobId,
          accountId,
          shouldCancel: () => record.cancelRequested,
        })
        record.status = record.cancelRequested ? 'cancelled' : 'completed'
        record.finishedAt = this.clock().toISOString()
        logger.info(
          record.status === 'cancelled' ? 'job.cancelled' : 'job.completed',
          record.status === 'cancelled' ? 'Job завершён после запроса отмены.' : 'Job успешно завершён.',
        )
        return result
      } catch (error: unknown) {
        record.status = error instanceof JobCancelledError ? 'cancelled' : 'failed'
        record.finishedAt = this.clock().toISOString()
        record.error = toSafeErrorMetadata(error)
        logger[record.status === 'cancelled' ? 'warn' : 'error'](
          record.status === 'cancelled' ? 'job.cancelled' : 'job.failed',
          record.status === 'cancelled' ? 'Job отменён.' : 'Job завершился ошибкой.',
          record.error,
        )
        throw error
      }
    }

    const result = previous.catch(() => undefined).then(execute)
    record.result = result
    this.jobs.set(jobId, record)
    const tail = result.then(() => undefined, () => undefined)
    this.accountTails.set(accountId, tail)
    tail.finally(() => {
      if (this.accountTails.get(accountId) === tail) this.accountTails.delete(accountId)
    })
    return { jobId, result }
  }

  getJob(jobId: string): JobSnapshot | undefined {
    const record = this.jobs.get(jobId)
    if (!record) return undefined
    const { result: _result, ...snapshot } = record
    return structuredClone(snapshot)
  }

  waitFor<T>(jobId: string): Promise<T> {
    const record = this.jobs.get(jobId)
    if (!record) return Promise.reject(new Error(`Unknown job: ${jobId}`))
    return record.result as Promise<T>
  }

  cancel(jobId: string): boolean {
    const record = this.jobs.get(jobId)
    if (!record || ['completed', 'failed', 'cancelled'].includes(record.status)) return false
    record.cancelRequested = true
    this.logger.child({ jobId, accountId: record.accountId }).warn(
      'job.cancel_requested',
      'Запрошена отмена job; она будет применена в безопасной точке.',
      { status: record.status },
    )
    return true
  }
}

module.exports = {
  AccountJobManager,
  JobCancelledError,
}
