import { resolveContext } from './account.mts'
import { executeConnectionRun } from './execution.ts'
import { dateParts } from './limits.ts'
import { createConnectionLogger, logged } from './logger.ts'
import { createConnectionInviterStore } from './noco-store.mts'
import { createConnectionUnipileAdapter } from './unipile-adapter.ts'
import { makeRun, publicHistory, publicRun } from './run-model.ts'
import { requestRunStop, waitOrStop } from './run-control.ts'
import { completedRunCanTopUp, failedRunCanRetry, prepareRunRetry,
  prepareRunTopUp, transientRunCanResume } from './retry-policy.ts'
import { connectionError, connectionErrorCode, transientConnectionError } from './errors.ts'
import { makeRetryState } from './retry-state.ts'
import { closeConnectionRunDay } from './day-window.ts'
import { createConnectionRunEvents, type ConnectionRunEvent } from './run-events.ts'
import type { ConnectionRunEventType, ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionRun, ConnectionRunStage } from './types.ts'

type ServiceOptions = Partial<Omit<ConnectionRuntime, 'adapter' | 'emit' | 'stopRequested'>> & {
  repository?: ConnectionRuntime['repository']
  adapter?: ReturnType<ConnectionRuntime['adapter']>
  autoRecover?: boolean
}

const activeRunStatus = (run: ConnectionRun) => run.status === 'running' ||
  ['waiting_retry', 'recovering', 'resolving_uncertain'].includes(run.stage)

export function createConnectionInviterService(options: ServiceOptions = {}) {
  const repository = options.repository
  if (!repository) throw new Error('Connection Inviter requires a LinkedIn repository.')
  const logger = options.logger ?? createConnectionLogger()
  const events = createConnectionRunEvents()
  const stopRequests = new Set<string>()
  const activeRuns = new Map<string, ConnectionRun>()
  const running = new Set<string>()
  const persistQueues = new Map<string, Promise<void>>()
  const lastPersistedAt = new Map<string, number>()
  const checkpointIntervalMs = 120_000
  let adapter: ReturnType<ConnectionRuntime['adapter']> | undefined
  const writerEnabled = options.writerEnabled ??
    String(process.env.LINKEDIN_CONNECTION_WRITER_ENABLED ?? '').toLowerCase() === 'true'
  const writerId = options.writerId ?? process.env.LINKEDIN_CONNECTION_WRITER_ID ??
    `local-${process.pid}`
  const runtime: ConnectionRuntime = {
    store: options.store ?? createConnectionInviterStore(), repository,
    adapter: () => adapter ??= options.adapter ?? createConnectionUnipileAdapter({ logger }),
    gate: options.gate, now: options.now ?? (() => new Date()),
    timeZone: options.timeZone ?? process.env.LINKEDIN_CONNECTION_TIME_ZONE ?? 'Europe/Moscow',
    random: options.random ?? Math.random,
    sleep: options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))),
    stopRequested: runId => stopRequests.has(runId), emit: events.emit,
    logger, writerEnabled, writerId
  }

  async function persistRunSnapshot(run: ConnectionRun) {
    const previous = persistQueues.get(run.runId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() =>
      runtime.store.updateRun(structuredClone(run)))
    persistQueues.set(run.runId, next)
    try { await next; lastPersistedAt.set(run.runId, runtime.now().getTime()) }
    finally { if (persistQueues.get(run.runId) === next) persistQueues.delete(run.runId) }
  }

  const save: SaveRun = async (run, event = 'progress', mode = 'checkpoint') => {
    const now = runtime.now().getTime()
    run.updatedAt = new Date(now).toISOString()
    const elapsed = now - (lastPersistedAt.get(run.runId) ?? 0)
    if (mode !== 'critical' && elapsed < checkpointIntervalMs) {
      runtime.emit(run, event)
      return
    }
    const resumeStage = run.stage
    const outerRetry = run.retryState?.provider !== 'noco' ? structuredClone(run.retryState) : undefined
    const outerTimer = outerRetry && run.timerState ? structuredClone(run.timerState) : undefined
    const outerNextActionAt = outerRetry ? run.nextActionAt : undefined
    const outerPausedAt = outerRetry ? run.pausedAt : undefined
    const outerErrorCode = outerRetry ? run.errorCode : undefined
    let nocoRetried = false
    while (true) {
      run.updatedAt = runtime.now().toISOString()
      if (run.status === 'running') {
        run.executorId = runtime.writerId; run.heartbeatAt = run.updatedAt
      }
      try {
        await persistRunSnapshot(run)
        if (nocoRetried) {
          nocoRetried = false; run.retryState = outerRetry; run.timerState = outerTimer
          run.nextActionAt = outerNextActionAt; run.pausedAt = outerPausedAt
          run.errorCode = outerErrorCode
          run.stage = resumeStage; runtime.emit(run, 'retry_succeeded')
          continue
        }
        logger.event('run_state_persist', 'succeeded', { runId: run.runId,
          platformAccountId: run.platformAccountId, runStatus: run.status, runStage: run.stage })
        runtime.emit(run, event)
        return
      } catch (error) {
        if (!transientConnectionError(error)) throw error
        nocoRetried = true
        runtime.store.recordRetry?.()
        run.retryState = makeRetryState(runtime, run, 'noco', 'update_run', error)
        run.stage = 'waiting_retry'; run.errorCode = run.retryState.errorCode
        run.pausedAt = runtime.now().toISOString(); run.nextActionAt = run.retryState.nextRetryAt
        run.timerState = { kind: 'overload_backoff', delayMs: run.retryState.delayMs,
          nextActionAt: run.retryState.nextRetryAt }
        logger.event('retry', 'failed', { runId: run.runId,
          platformAccountId: run.platformAccountId, provider: 'noco', operation: 'update_run',
          attempt: run.retryState.attempt, errorCode: run.retryState.errorCode,
          delayMs: run.retryState.delayMs, nextRetryAt: run.retryState.nextRetryAt })
        runtime.emit(run, 'retry_scheduled')
        if (!await waitOrStop(runtime, run.runId, run.retryState.delayMs)) {
          throw connectionError('connection_stop_requested', 'Connection run stop was requested.')
        }
      }
    }
  }

  const ownsWriterLease = (run: ConnectionRun) => {
    if (!runtime.writerEnabled) return false
    if (!run.executorId || run.executorId === runtime.writerId) return true
    const heartbeat = Date.parse(run.heartbeatAt ?? '')
    return !Number.isFinite(heartbeat) || runtime.now().getTime() - heartbeat > 5 * 60_000
  }

  const execute = async (run: ConnectionRun) => {
    if (activeRuns.has(run.runId) || running.has(run.runId)) return
    if (!ownsWriterLease(run)) {
      logger.event('writer_lease', 'failed', { runId: run.runId,
        platformAccountId: run.platformAccountId, errorCode: 'connection_writer_active' })
      return
    }
    run.executorId = runtime.writerId; run.heartbeatAt = runtime.now().toISOString()
    activeRuns.set(run.runId, run)
    const heartbeat = setInterval(() => {
      if (!activeRuns.has(run.runId) || run.status !== 'running') return
      if (runtime.now().getTime() - (lastPersistedAt.get(run.runId) ?? 0) < checkpointIntervalMs) return
      run.heartbeatAt = runtime.now().toISOString()
      void persistRunSnapshot(run).catch(error => logger.event('writer_heartbeat', 'failed', {
        runId: run.runId, platformAccountId: run.platformAccountId,
        errorCode: connectionErrorCode(error) }))
    }, 30_000)
    heartbeat.unref?.()
    try { await executeConnectionRun(runtime, run, running, save) }
    finally {
      clearInterval(heartbeat); activeRuns.delete(run.runId); stopRequests.delete(run.runId)
    }
  }

  async function recover() {
    if (!runtime.writerEnabled) return
    try {
      const today = dateParts(runtime.now(), runtime.timeZone).localDate
      const runs = await runtime.store.listRuns(100)
      const blockedAccounts = new Set<number>()
      const stale = runs.filter(run => run.localDate !== today && activeRunStatus(run) &&
        ownsWriterLease(run))
      for (const run of stale) {
        const unsafe = (await runtime.store.listOpenHistory(run.platformAccountId, 1000))
          .filter(item => ['sending', 'uncertain'].includes(item.status))
        if (unsafe.length) {
          blockedAccounts.add(run.platformAccountId)
          run.status = 'running'; run.stage = 'recovering'; run.finishedAt = undefined
          await save(run, 'stage_changed', 'critical')
          void execute(run).then(async () => {
            const current = await runtime.store.getRunByKey(`${run.platformAccountId}:${today}`)
            if (current && activeRunStatus(current) && ownsWriterLease(current)) {
              current.status = 'running'; current.stage = 'recovering'; current.finishedAt = undefined
              await save(current, 'stage_changed', 'critical'); await execute(current)
            }
          }).catch(error => logger.event('run_recovery', 'failed', {
            platformAccountId: run.platformAccountId, errorCode: connectionErrorCode(error) }))
        } else {
          await closeConnectionRunDay(runtime, run, save)
        }
      }
      const recoverable = runs.filter(run => run.localDate === today && activeRunStatus(run) &&
        ownsWriterLease(run) && !blockedAccounts.has(run.platformAccountId))
      for (const run of recoverable) {
        run.status = 'running'; run.stage = 'recovering'; run.finishedAt = undefined
        await save(run, 'stage_changed', 'critical'); void execute(run)
      }
    } catch (error) {
      logger.event('run_recovery', 'failed', { errorCode: connectionErrorCode(error) })
    }
  }

  const service = {
    async list() { return logged(logger, 'runs_list', {}, async () =>
      (await runtime.store.listRuns(100)).map(publicRun)) },
    async get(runId: string) {
      return logged(logger, 'run_read', { runId }, async () => {
        const active = activeRuns.get(runId)
        if (active) return publicRun(active)
        const run = await runtime.store.getRun(runId); return run && publicRun(run)
      })
    },
    subscribe(runId: string, listener: (event: ConnectionRunEvent) => void) {
      return events.subscribe(runId, listener)
    },
    async history(platformAccountId: number) {
      return logged(logger, 'history_list', { platformAccountId }, async () =>
        (await runtime.store.listHistory(platformAccountId, 100)).map(publicHistory))
    },
    async stacks() { return logged(logger, 'stacks_list', {}, () => repository.listStacks()) },
    async readiness(platformAccountId: number) {
      return logged(logger, 'readiness', { platformAccountId }, async () => {
        const context = await resolveContext(runtime, platformAccountId)
        const accountRuns = await runtime.store.listRunsForAccount(platformAccountId, 100)
        const latest = accountRuns[0]
        const sevenDaySent = accountRuns.filter(run => runtime.now().getTime() -
          Date.parse(`${run.localDate}T00:00:00+03:00`) < 7 * 86_400_000)
          .reduce((sum, run) => sum + Number(run.counters.sent || 0), 0)
        return { platformAccountId, clientId: context.clientId, clientName: context.clientName,
          stackId: context.stackId, stack: context.stack, ready: Boolean(context.stack),
          writerEnabled: runtime.writerEnabled, writerId: runtime.writerId, sevenDaySent,
          safeRecruiterOnlyAvailable: !context.stack, latest: latest ? publicRun(latest) : undefined }
      })
    },
    async saveStack(platformAccountId: number, stackId: number) {
      return logged(logger, 'stack_save', { platformAccountId }, async () => {
        const context = await resolveContext(runtime, platformAccountId)
        const stack = await repository.updatePrimaryStack(context.clientId, stackId)
        return { platformAccountId, clientId: context.clientId, stackId: stack.id, stack: stack.name,
          ready: true, writerEnabled: runtime.writerEnabled, safeRecruiterOnlyAvailable: false }
      })
    },
    async start(platformAccountId: number, input: { safeRecruiterOnly?: boolean } = {}) {
      if (!runtime.writerEnabled) throw connectionError('connection_writer_disabled',
        'Connection Inviter is read-only on this backend.')
      return logged(logger, 'run_start', { platformAccountId,
        safeRecruiterOnly: input.safeRecruiterOnly === true }, async () => {
        const date = dateParts(runtime.now(), runtime.timeZone)
        const existing = await runtime.store.getRunByKey(`${platformAccountId}:${date.localDate}`)
        const context = await resolveContext(runtime, platformAccountId)
        const unresolvedWrites = (await runtime.store.listOpenHistory(platformAccountId, 1000))
          .filter(item => ['sending', 'uncertain'].includes(item.status))
        if (unresolvedWrites.length) {
          throw connectionError('connection_invitation_result_pending',
            'A previous invitation result must be reconciled before a new daily run can start.')
        }
        if (existing) {
          if (activeRunStatus(existing)) {
            if (ownsWriterLease(existing) && !activeRuns.has(existing.runId)) void execute(existing)
            return publicRun(existing)
          }
          const ready = Boolean(context.stack || input.safeRecruiterOnly)
          const history = existing.status === 'failed'
            ? await runtime.store.listHistory(platformAccountId, 1000) : []
          const retry = ready && failedRunCanRetry(existing, history)
          const topUp = ready && completedRunCanTopUp(existing, context)
          const resume = ready && transientRunCanResume(existing)
          const stackResume = existing.status === 'paused' && existing.stage === 'stack_required' && ready
          if (stackResume || retry || topUp || resume) {
            if (topUp || resume) prepareRunTopUp(existing, context, input.safeRecruiterOnly === true)
            else prepareRunRetry(existing, context, input.safeRecruiterOnly === true)
            await save(existing, 'stage_changed', 'critical'); void execute(existing)
          }
          if (existing.status === 'failed' && !retry) {
            throw connectionError('connection_run_retry_blocked',
              'This failed run may have reached an invitation write and requires review.')
          }
          return publicRun(existing)
        }
        const run = makeRun(context, runtime.now(), runtime.timeZone, input.safeRecruiterOnly === true)
        run.executorId = runtime.writerId; run.heartbeatAt = runtime.now().toISOString()
        const created = await runtime.store.createRun(run)
        lastPersistedAt.set(created.run.runId, runtime.now().getTime())
        logger.event('run_create', 'succeeded', { runId: created.run.runId, platformAccountId,
          created: created.created, runStatus: created.run.status, runStage: created.run.stage })
        runtime.emit(created.run, 'snapshot')
        if (created.created && run.status === 'running') void execute(run)
        return publicRun(created.run)
      })
    },
    async stopRun(runId: string) { return requestRunStop(runtime, activeRuns, stopRequests, runId, save) },
    async recover() { await recover() },
    stop() { events.clear() }
  }

  if (options.autoRecover !== false) queueMicrotask(() => void recover())
  return service
}
